import { supabaseUrl, publishableKey } from './config.js'

const days = [
  ['12/29', '화', '오타루'],
  ['12/30', '수', '비에이 투어'],
  ['12/31', '목', '삿포로'],
  ['01/01', '금', '새해 · 귀국'],
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
const addButton = $('add')
const flightSection = $('flights')
const printButton = $('print')
const flights = [
  ['outbound', '출발', '나리타 NRT', '신치토세 CTS'],
  ['return', '귀국', '신치토세 CTS', '나리타 NRT'],
]
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

function clock(minutes) {
  if (minutes === null || minutes === undefined) return ''
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0')
}

function toMinutes(value) {
  if (!value) return null
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function renderFlights() {
  flightSection.replaceChildren()
  for (const [id, label, from, to] of flights) {
    const row = rows.get(id)
    if (!row) continue
    const [date, weekday] = days[row.day_index]
    const [month, day] = date.split('/').map(Number)
    const duration = Number.isInteger(row.end_min) && Number.isInteger(row.start_min) ? row.end_min - row.start_min : null
    const head = make('div', '', 'flight-top')
    head.append(make('strong', label + ' · ' + month + '월 ' + day + '일 (' + weekday + ')'))
    if (duration > 0) head.append(make('small', '비행 ' + Math.floor(duration / 60) + '시간 ' + duration % 60 + '분'))
    const path = make('div', '', 'flight-path')
    const departure = make('div', '', 'airport')
    departure.append(make('b', clock(row.start_min) || '—'), make('small', from))
    const arrival = make('div', '', 'airport')
    arrival.append(make('b', clock(row.end_min) || '—'), make('small', to))
    const line = make('span', '✈', 'flight-line')
    line.setAttribute('aria-hidden', 'true')
    path.append(departure, line, arrival)
    const card = make('article', '', 'flight')
    card.append(head, path)
    flightSection.append(card)
  }
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
  const tab = make('button')
  tab.type = 'button'
  tab.id = 'tab-' + index
  tab.setAttribute('aria-label', date + ' ' + weekday + ' ' + location)
  const number = make('span', String(index + 1).padStart(2, '0'), 'day-no')
  number.setAttribute('aria-hidden', 'true')
  const copy = make('span', '', 'tab-copy')
  copy.append(make('b', date + ' · ' + weekday), make('small', location))
  tab.append(number, copy)
  const option = make('option', date + ' (' + weekday + ')')
  option.value = String(index)
  $('slot-day').append(option)
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
  let url = new URL(row.map_origin ? 'https://www.google.com/maps/dir/' : 'https://www.google.com/maps/search/')
  url.searchParams.set('api', '1')
  if (row.map_origin) {
    url.searchParams.set('origin', row.map_origin)
    url.searchParams.set('destination', query)
    url.searchParams.set('travelmode', 'transit')
  } else {
    url.searchParams.set('query', query)
  }
  if (!row.map_origin && /^https:\/\//i.test(query)) {
    try {
      const supplied = new URL(query)
      if (supplied.hostname === 'maps.app.goo.gl' ||
          (supplied.hostname === 'www.google.com' && supplied.pathname.startsWith('/maps/'))) url = supplied
    } catch {}
  }
  const label = row.map_origin ? 'Google 지도 경로' : 'Google 지도'
  const link = make('a', row.map_origin ? '경로 ↗' : '지도 ↗', 'map-link')
  link.href = url.href
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.setAttribute('aria-label', row.title + ' · ' + label)
  return link
}

function render() {
  renderFlights()
  const focused = document.activeElement?.dataset.slot
  for (const [index, { list }] of panels.entries()) {
    const slots = Array.from(rows.values()).filter((row) => row.day_index === index)
    list.replaceChildren()
    if (!slots.length) list.append(make('li', emptyMessage, 'muted'))
    for (const row of slots) {
      const item = make('li', '', row.title ? 'slot' : 'slot unplanned')
      if (row.tentative) item.classList.add('is-tentative')
      const content = make('div', '', 'slot-content')
      const title = make('div', '', 'slot-title-row')
      title.append(make('h3', row.title || '입력 필요'))
      if (row.title && (!row.tentative || row.map_query)) title.append(mapLink(row, index))
      content.append(title)
      if (row.details) content.append(make('p', row.details))
      const badges = make('div', '', 'slot-badges')
      if (row.title && reservations[row.reservation]) {
        badges.append(make('span', reservations[row.reservation], 'badge'))
      }
      if (!row.title) badges.append(make('span', '미정', 'badge'))
      if (row.tentative) badges.append(make('span', '후보', 'badge candidate'))
      if (badges.childElementCount) content.append(badges)
      const point = make('span', '', 'point')
      point.setAttribute('aria-hidden', 'true')
      const button = make('button', '편집')
      button.type = 'button'
      button.dataset.slot = row.id
      button.setAttribute('aria-label', (row.title || row.time_label) + ' 일정 편집')
      button.addEventListener('click', () => openEditor(rows.get(row.id)))
      item.append(make('time', row.time_label), point, content, button)
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
  edit = row || { id: 'user-' + crypto.randomUUID(), revision: null }
  $('editor-title').textContent = row ? '일정 편집' : '일정 추가'
  $('edit-time').textContent = row?.time_label ? '현재 시간 · ' + row.time_label : ''
  $('slot-day').value = row?.day_index ?? activeDay
  $('slot-start').value = clock(row?.start_min)
  $('slot-end').value = clock(row?.end_min)
  $('slot-start').required = !row
  $('slot-title').required = !row || Boolean(row.title)
  $('slot-title').value = row?.title ?? ''
  $('slot-place').value = row?.map_query ?? ''
  $('slot-details').value = row?.details ?? ''
  $('slot-tentative').checked = row?.tentative ?? false
  $('reservation').value = ['confirmed', 'unavailable'].includes(row?.reservation) ? row.reservation : 'pending'
  $('edit-status').textContent = ''
  $('latest').hidden = true
  $('save').disabled = false
  $('cancel').disabled = false
  if (!editor.open) editor.showModal()
}

addButton.addEventListener('click', () => openEditor())
printButton.addEventListener('click', () => window.print())
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
  addButton.hidden = true
  printButton.hidden = true
  flightSection.hidden = true
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
  addButton.hidden = false
  printButton.hidden = false
  flightSection.hidden = false
  if (changed) render()
  status.textContent = '공유 일정 연결됨 · 변경사항 자동으로 받는 중'
  return true
}

$('edit-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!shareKey || !edit || saving) return
  const title = $('slot-title').value.trim()
  const starts = toMinutes($('slot-start').value)
  const ends = toMinutes($('slot-end').value)
  if (($('slot-title').required && !title) || (ends !== null && (starts === null || ends < starts))) {
    $('edit-status').textContent = title ? '종료 시간은 시작 시간 이후로 입력해 주세요.' : '일정 이름을 입력해 주세요.'
    return
  }
  const snapshot = edit
  const day = Number($('slot-day').value)
  saving = true
  $('save').disabled = true
  $('cancel').disabled = true
  $('edit-status').textContent = '공유 저장 중…'
  try {
    const { data, error } = await requestTrip('sapporo_save_plan', {
      slot_id: snapshot.id, expected_revision: snapshot.revision, day_number: day,
      starts, ends, new_title: title, new_details: $('slot-details').value.trim(),
      new_place: $('slot-place').value.trim(), new_reservation: title ? $('reservation').value : 'pending',
      is_tentative: $('slot-tentative').checked,
    })
    if (error === '42501') {
      requireLink('공유 링크가 유효하지 않아요. 최신 링크를 열어 주세요.')
    } else if (error) {
      $('edit-status').textContent = '저장하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.'
    } else if (!data) {
      $('edit-status').textContent = '다른 기기에서 먼저 변경했거나 접근 권한이 바뀌었어요.'
      $('latest').hidden = snapshot.revision === null
      await refresh()
    } else {
      editor.close()
      selectDay(day)
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
