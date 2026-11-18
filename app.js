import { supabaseUrl, publishableKey } from './config.js'

const days = [
  ['12/29', '화', '오타루'],
  ['12/30', '수', '비에이'],
  ['12/31', '목', '삿포로'],
  ['1/1', '금', '귀국'],
]
const reservations = {
  unknown: '예약 여부 미확인',
  pending: '예약 필요',
  confirmed: '예약 완료',
  none: '예약 불필요',
}
const $ = (id) => document.getElementById(id)
const tabs = $('date-tabs')
const pages = $('pages')
const editor = $('editor')
const status = $('status')
const login = $('login')
const panels = []
let db
let account = null
let rows = new Map()
let ready = false
let activeDay = 0
let edit
let saving = false
let generation = 0
let readId = 0
let emptyMessage = '로그인하면 이 날짜의 일정을 볼 수 있어요.'

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

function render() {
  const focused = document.activeElement?.dataset.slot
  for (const [index, { list }] of panels.entries()) {
    const slots = Array.from(rows.values()).filter((row) => row.day_index === index)
    list.replaceChildren()
    if (!slots.length) list.append(make('li', emptyMessage, 'muted'))
    for (const row of slots) {
      const item = make('li', '', row.title ? 'slot' : 'slot unplanned')
      const content = make('div')
      content.append(
        make('h3', row.title || '입력 필요'),
        make('span', row.title ? row.plan_label : '미정', 'badge'),
      )
      if (row.title) content.append(make('span', reservations[row.reservation], 'badge'))
      if (row.details) content.append(make('p', row.details))
      item.append(make('time', row.time_label), content)
      if (row.editable) {
        const button = make('button', '편집')
        button.type = 'button'
        button.dataset.slot = row.id
        button.setAttribute('aria-label', row.time_label + ' 일정 편집')
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
  $('edit-time').textContent = row.time_label
  $('slot-title').value = row.title
  $('slot-details').value = row.details
  $('reservation').value = row.reservation
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

async function refresh() {
  if (!account) return false
  const token = generation
  const request = ++readId
  const { data, error } = await db.from('sapporo_slots')
    .select('id,day_index,time_label,title,details,plan_label,reservation,editable,revision')
    .order('day_index').order('sort_order')
  if (token !== generation || request !== readId) return false
  if (error) {
    status.textContent = '연결이 끊겼어요. 연결이 돌아오면 다시 동기화해요.'
    return false
  }
  const next = new Map(data.map((row) => [row.id, row]))
  const changed = !ready || next.size !== rows.size ||
    data.some((row) => rows.get(row.id)?.revision !== row.revision)
  ready = true
  rows = next
  emptyMessage = data.length ? '이 날짜에 등록된 일정이 없어요.' : '이 계정에 여행 일정 접근 권한이 없거나 일정이 아직 등록되지 않았어요.'
  if (changed) render()
  status.textContent = data.length ? '공유 일정 연결됨 · 변경사항 자동으로 받는 중' : emptyMessage
  if (!data.length && editor.open && !saving) editor.close()
  return true
}

function applySession(session) {
  const next = session?.user.id ?? null
  if (next === account) return
  account = next
  generation++
  ready = false
  rows.clear()
  if (editor.open) editor.close()
  login.hidden = Boolean(account)
  $('logout').hidden = !account
  emptyMessage = account ? '공유 일정을 불러오는 중이에요.' : '로그인하면 이 날짜의 일정을 볼 수 있어요.'
  status.textContent = emptyMessage
  render()
  if (account) void refresh()
}

$('edit-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!account || !edit || saving) return
  const title = $('slot-title').value.trim()
  const details = $('slot-details').value.trim()
  const reservation = title ? $('reservation').value : 'unknown'
  const snapshot = edit
  const token = generation
  saving = true
  $('save').disabled = true
  $('cancel').disabled = true
  $('edit-status').textContent = '공유 저장 중…'
  try {
    const { data, error } = await db.from('sapporo_slots')
      .update({ title, details, reservation })
      .eq('id', snapshot.id).eq('revision', snapshot.revision).select('id')
    if (token !== generation) return
    if (error) {
      $('edit-status').textContent = '저장하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.'
    } else if (!data.length) {
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

login.addEventListener('submit', async (event) => {
  event.preventDefault()
  const button = login.querySelector('button')
  const email = $('email').value.trim()
  const emailRedirectTo = new URL('./', location.href).href
  button.disabled = true
  status.textContent = '로그인 링크를 요청 중이에요.'
  try {
    const { error } = await db.auth.signInWithOtp({ email, options: {
      emailRedirectTo,
      shouldCreateUser: false,
    } })
    status.textContent = error
      ? '로그인 링크를 보낼 수 없어요. 초대받은 이메일과 메일 설정을 확인해 주세요.'
      : '로그인 링크를 보냈어요. 메일함을 확인해 주세요.'
  } finally {
    button.disabled = false
  }
})

$('logout').addEventListener('click', async () => {
  const button = $('logout')
  button.disabled = true
  try {
    const { error } = await db.auth.signOut({ scope: 'local' })
    if (error) status.textContent = '로그아웃하지 못했어요. 다시 시도해 주세요.'
    else applySession(null)
  } finally {
    button.disabled = false
  }
})

async function start() {
  if (!supabaseUrl || !publishableKey) {
    status.textContent = '공유 저장소 연결을 준비 중이에요.'
    emptyMessage = '공유 저장소가 연결되면 이 날짜의 일정이 표시돼요.'
    render()
    return
  }
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm')
    db = createClient(supabaseUrl, publishableKey, {
      auth: { storage: sessionStorage, storageKey: 'sapporo-trip-2026-auth' },
    })
    const { data: { session } } = await db.auth.getSession()
    login.hidden = Boolean(session)
    if (session) applySession(session)
    else status.textContent = emptyMessage
    db.auth.onAuthStateChange((_event, next) => {
      setTimeout(() => applySession(next), 0)
    })
    setInterval(() => { if (!document.hidden && !saving) void refresh() }, 4000)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !saving) void refresh()
    })
    window.addEventListener('online', () => void refresh())
  } catch {
    status.textContent = '공유 저장소를 연결할 수 없어요. 페이지를 새로고침해 주세요.'
  }
}
void start()
