import { supabaseUrl, publishableKey } from './config.js'

const days = [
  ['12/29', '화', '오타루'],
  ['12/30', '수', '비에이'],
  ['12/31', '목', '삿포로'],
  ['1/1', '금', '귀국'],
]
const reservations = {
  unknown: '예약 전',
  pending: '예약 전',
  confirmed: '예약 완료',
  unavailable: '예약 불가',
}
const $ = (id) => document.getElementById(id)
const tabs = $('date-tabs')
const pages = $('pages')
const editor = $('editor')
const status = $('status')
const shareButton = $('share')
const linkStorage = 'sapporo-trip-share'
const panels = []
let shareKey
let rows = new Map()
let ready = false
let activeDay = 0
let edit
let saving = false
let readId = 0
let emptyMessage = '공유 링크로 열면 이 날짜의 일정을 보고 수정할 수 있어요.'

function make(tag, value, className) {
  const node = document.createElement(tag)
  if (value) node.textContent = value
  if (className) node.className = className
  return node
}

function selectDay(index, focus = false) {
  activeDay = index
  pages.style.transform = 'translateX(-' + index * 100 + '%)'
  for (const [day, panel] of panels.entries()) {
    const selected = index === day
    panel.section.inert = !selected
    panel.section.setAttribute('aria-hidden', String(!selected))
    panel.tab.setAttribute('aria-selected', String(selected))
    panel.tab.tabIndex = selected ? 0 : -1
  }
  const selected = panels[index]
  pages.parentElement.style.height = selected.section.offsetHeight + 'px'
  if (focus) selected.tab.focus()
}

const resize = new ResizeObserver(() => {
  pages.parentElement.style.height = panels[activeDay].section.offsetHeight + 'px'
})

for (const [index, [date, weekday, location]] of days.entries()) {
  const tab = make('button', date + ' ' + weekday)
  tab.type = 'button'
  tab.id = 'tab-' + index
  tab.append(make('small', location))
  tab.setAttribute('role', 'tab')
  tab.setAttribute('aria-controls', 'day-' + index)
  tab.addEventListener('click', () => selectDay(index))
  tab.addEventListener('keydown', (event) => {
    const nextIndex = { ArrowLeft: (index + 3) % 4, ArrowRight: (index + 1) % 4, Home: 0, End: 3 }[event.key]
    if (nextIndex === undefined) return
    event.preventDefault()
    selectDay(nextIndex, true)
  })
  const section = make('section', '', 'day')
  section.id = 'day-' + index
  section.setAttribute('role', 'tabpanel')
  section.setAttribute('aria-labelledby', tab.id)
  section.tabIndex = 0
  const list = make('ul', '', 'slots')
  section.append(make('h2', date + ' (' + weekday + ') · ' + location), list)
  tabs.append(tab)
  pages.append(section)
  panels.push({ section, list, tab })
  resize.observe(section)
}

function mapLink(row, dayIndex) {
  const area = dayIndex === 0 ? '오타루' : '삿포로'
  const query = row.map_query || row.title + ' ' + area
  const url = new URL(row.map_origin ? 'https://www.google.com/maps/dir/' : 'https://www.google.com/maps/search/')
  url.searchParams.set('api', '1')
  if (row.map_origin) {
    url.searchParams.set('origin', row.map_origin)
    url.searchParams.set('destination', query)
    url.searchParams.set('travelmode', 'transit')
  } else {
    url.searchParams.set('query', query)
  }
  const link = make('a', row.map_origin ? 'Google 지도 경로' : 'Google 지도', 'map-link')
  link.href = url.href
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.setAttribute('aria-label', row.title + ' · ' + link.textContent)
  return link
}

function render() {
  const focused = document.activeElement?.dataset.slot
  for (const [index, { list }] of panels.entries()) {
    const slots = Array.from(rows.values()).filter((row) => row.day_index === index)
    list.replaceChildren()
    if (!slots.length) list.append(make('li', emptyMessage, 'muted'))
    for (const row of slots) {
      const item = make('li', '', row.title ? 'slot' : 'slot unplanned')
      const content = make('div')
      content.append(make('h3', row.title || '입력 필요'))
      if (!row.title) content.append(make('span', '미정', 'badge'))
      if (row.title && reservations[row.reservation]) {
        content.append(make('span', reservations[row.reservation], 'badge'))
      }
      if (row.details) content.append(make('p', row.details))
      if (row.title) content.append(mapLink(row, index))
      item.append(make('time', row.time_label), content)
      if (row.editable || (row.title && row.reservation !== 'none')) {
        const button = make('button', row.editable ? '편집' : '예약 상태')
        button.type = 'button'
        button.dataset.slot = row.id
        button.setAttribute('aria-label', row.editable ? row.time_label + ' 일정 편집' : row.title + ' 예약 상태 변경')
        button.addEventListener('click', () => openEditor(rows.get(row.id)))
        item.append(button)
      }
      list.append(item)
    }
  }
  if (focused) {
    const button = Array.from(panels[activeDay].list.querySelectorAll('button'))
      .find((candidate) => candidate.dataset.slot === focused)
    button?.focus()
  }
}
selectDay(0)
render()

function openEditor(row) {
  edit = row
  $('editor-title').textContent = row.editable ? '일정 편집' : '예약 상태 변경'
  $('plan-fields').hidden = !row.editable
  $('edit-time').textContent = row.editable ? row.time_label : row.time_label + ' · ' + row.title
  $('slot-title').value = row.title
  $('slot-details').value = row.details
  $('reservation').value = ['confirmed', 'unavailable'].includes(row.reservation) ? row.reservation : 'pending'
  $('edit-status').textContent = ''
  $('latest').hidden = true
  $('save').disabled = false
  $('cancel').disabled = false
  if (!editor.open) editor.showModal()
}

$('cancel').addEventListener('click', () => editor.close())
editor.addEventListener('cancel', (event) => {
  if (saving) event.preventDefault()
})

async function requestTrip(action, args = {}) {
  try {
    const response = await fetch(supabaseUrl + '/rest/v1/rpc/' + action, {
      method: 'POST',
      headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ share_key: shareKey, ...args }),
      cache: 'no-store',
    })
    const body = await response.json()
    return response.ok ? { data: body } : { error: body.code ?? 'connection' }
  } catch {
    return { error: 'connection' }
  }
}

function requireLink(message) {
  shareKey = undefined
  try { sessionStorage.removeItem(linkStorage) } catch {}
  rows.clear()
  ready = false
  shareButton.hidden = true
  if (editor.open) editor.close()
  emptyMessage = message
  status.textContent = message
  render()
}

async function refresh() {
  if (!shareKey) return false
  const request = ++readId
  const { data, error } = await requestTrip('sapporo_read_shared')
  if (request !== readId || !shareKey) return false
  if (error === '42501') {
    requireLink('공유 링크가 유효하지 않아요. 최신 링크를 열어 주세요.')
    return false
  }
  if (error) {
    status.textContent = '공유 일정에 연결할 수 없어요. 다시 연결하는 중이에요.'
    return false
  }
  const next = new Map(data.map((row) => [row.id, row]))
  const changed = !ready || next.size !== rows.size ||
    data.some((row) => rows.get(row.id)?.revision !== row.revision)
  ready = true
  rows = next
  emptyMessage = '이 날짜에 등록된 일정이 없어요.'
  shareButton.hidden = false
  if (changed) render()
  status.textContent = '공유 일정 연결됨 · 변경사항 자동으로 받는 중'
  return true
}

$('edit-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!shareKey || !edit || saving) return
  const title = $('slot-title').value.trim()
  const details = $('slot-details').value.trim()
  const reservation = title ? $('reservation').value : 'pending'
  const snapshot = edit
  saving = true
  $('save').disabled = true
  $('cancel').disabled = true
  $('edit-status').textContent = '공유 저장 중…'
  try {
    const { data, error } = await requestTrip('sapporo_update_shared', {
      slot_id: snapshot.id, expected_revision: snapshot.revision,
      new_title: title, new_details: details, new_reservation: reservation,
    })
    if (error === '42501') {
      requireLink('공유 링크가 유효하지 않아요. 최신 링크를 열어 주세요.')
    } else if (error) {
      $('edit-status').textContent = '저장하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.'
    } else if (!data) {
      $('edit-status').textContent = '다른 기기에서 먼저 변경했거나 접근 권한이 바뀌었어요.'
      $('latest').hidden = false
      await refresh()
    } else {
      editor.close()
      await refresh()
    }
  } finally {
    saving = false
    $('save').disabled = !$('latest').hidden
    $('cancel').disabled = false
  }
})

$('latest').addEventListener('click', async () => {
  const id = edit.id
  if (await refresh()) {
    const latest = rows.get(id)
    if (latest && editor.open) openEditor(latest)
  }
})

shareButton.addEventListener('click', async () => {
  const url = new URL('./', location.href)
  url.hash = new URLSearchParams({ share: shareKey }).toString()
  try {
    await navigator.clipboard.writeText(url.href)
    shareButton.textContent = '링크 복사됨'
    setTimeout(() => { shareButton.textContent = '공유 링크 복사' }, 2000)
  } catch {
    status.textContent = '복사하지 못했어요. 처음 받은 공유 링크를 사용해 주세요.'
  }
})

function start() {
  let key = new URLSearchParams(location.hash.slice(1)).get('share')
  try {
    if (key === null) key = sessionStorage.getItem(linkStorage)
    if (/^[0-9a-f]{64}$/.test(key)) {
      sessionStorage.setItem(linkStorage, key)
      if (location.hash) history.replaceState(null, '', location.pathname + location.search)
    }
  } catch {}
  if (!/^[0-9a-f]{64}$/.test(key)) {
    status.textContent = emptyMessage
    return
  }
  shareKey = key
  status.textContent = '공유 일정을 불러오는 중이에요.'
  void refresh()
  setInterval(() => { if (!document.hidden && !saving) void refresh() }, 4000)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !saving) void refresh()
  })
  window.addEventListener('online', () => void refresh())
}
start()
