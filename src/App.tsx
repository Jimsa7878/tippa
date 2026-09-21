import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Check, ChevronRight, CircleDollarSign, Clock3, Crown, Lock, LogOut, Receipt, Unlock, Users } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

type Pick = '1' | 'X' | '2'
type Match = { id?: string; number: number; home: string; away: string; kickoff: string; venue?: string | null; info?: string | null; picks: Record<Pick, number>; mine?: Pick }
type Group = { id: string; name: string; join_code: string; max_members: number }
type GroupMember = { user_id: string; display_name: string; role: 'owner' | 'admin' | 'member'; active: boolean }
type Round = { id: string; external_draw_number: number; label: string; status: string; internal_deadline_at: string; official_close_at: string | null; weekly_contribution: number; captain_user_id: string | null }
type GroupVote = { match_id: string; user_id: string; selection: Pick }
type Payment = { user_id: string; amount: number; status: 'unpaid' | 'reported' | 'confirmed' | 'rejected' }

function leadingPick(picks: Record<Pick, number>): Pick {
  return (Object.entries(picks).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'X') as Pick
}

const pickOrder: Pick[] = ['1', 'X', '2']

function buildSystemColumns(matches: Match[], votes: GroupVote[]) {
  const rankedMatches = matches.map((match, index) => {
    const matchVotes = votes.filter((vote) => vote.match_id === match.id)
    const counts = Object.fromEntries(pickOrder.map((pick) => [pick, matchVotes.filter((vote) => vote.selection === pick).length])) as Record<Pick, number>
    const ordered = pickOrder.slice().sort((left, right) => counts[right] - counts[left] || match.picks[right] - match.picks[left] || pickOrder.indexOf(left) - pickOrder.indexOf(right))
    const total = matchVotes.length || 1
    const topCount = counts[ordered[0]]
    const spread = matchVotes.length ? (total - topCount) / total : (match.picks[ordered[0]] + match.picks[ordered[1]]) / 100
    return { index, ordered, spread }
  }).sort((left, right) => right.spread - left.spread || left.index - right.index)

  const fullIndex = rankedMatches[0]?.index
  const halfIndexes = new Set(rankedMatches.slice(1, 6).map((match) => match.index))
  return matches.map((match, index) => {
    const matchVotes = votes.filter((vote) => vote.match_id === match.id)
    const counts = Object.fromEntries(pickOrder.map((pick) => [pick, matchVotes.filter((vote) => vote.selection === pick).length])) as Record<Pick, number>
    const ordered = pickOrder.slice().sort((left, right) => counts[right] - counts[left] || match.picks[right] - match.picks[left] || pickOrder.indexOf(left) - pickOrder.indexOf(right))
    if (index === fullIndex) return pickOrder
    if (halfIndexes.has(index)) return [ordered[0], ordered[1]].sort((left, right) => pickOrder.indexOf(left) - pickOrder.indexOf(right))
    return [ordered[0]]
  })
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [groupId, setGroupId] = useState(() => sessionStorage.getItem('tippa-group-id'))
  const [group, setGroup] = useState<Group | null>(null)
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([])
  const [groupLoading, setGroupLoading] = useState(false)
  const [round, setRound] = useState<Round | null>(null)
  const [liveMatches, setLiveMatches] = useState<Match[] | null>(null)
  const [roundRefreshKey, setRoundRefreshKey] = useState(0)
  const [activeSection, setActiveSection] = useState<'round' | 'team'>('round')
  const [selected, setSelected] = useState<Record<number, Pick>>({})
  const [groupVotes, setGroupVotes] = useState<GroupVote[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [lockedSystem, setLockedSystem] = useState<Record<number, Pick[]> | null>(null)
  const pendingPicks = useRef<Record<number, Pick>>({})
  const loadedRoundId = useRef<string | null>(null)
  const activeMatches = liveMatches ?? []
  const captain = groupMembers.find((member) => member.user_id === round?.captain_user_id) ?? groupMembers[0]

  const system = useMemo(() => {
    const liveColumns = buildSystemColumns(activeMatches, groupVotes)
    const columns = lockedSystem ? activeMatches.map((_, index) => lockedSystem[index + 1] ?? liveColumns[index]) : liveColumns
    return { columns, rows: columns.reduce((total, column) => total * column.length, 1) }
  }, [activeMatches, groupVotes, lockedSystem])

  useEffect(() => {
    async function startAnonymousSession() {
      const { data, error } = await supabase.auth.getSession()
      if (error) {
        setAuthError(error.message)
      } else if (data.session) {
        const { error: userError } = await supabase.auth.getUser()
        if (!userError) {
          setSession(data.session)
        } else {
          await supabase.auth.signOut()
          const result = await supabase.auth.signInAnonymously()
          if (result.error) setAuthError(result.error.message)
          else setSession(result.data.session)
        }
      } else {
        const result = await supabase.auth.signInAnonymously()
        if (result.error) setAuthError(result.error.message)
        else setSession(result.data.session)
      }
      setAuthLoading(false)
    }

    startAnonymousSession()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthLoading(false)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session || !groupId) return

    async function loadGroup() {
      setGroupLoading(true)
      const [groupResult, membersResult] = await Promise.all([
        supabase.from('groups').select('id, name, join_code, max_members').eq('id', groupId).single(),
        supabase.from('group_members').select('user_id, display_name, role, active').eq('group_id', groupId).eq('active', true).order('joined_at'),
      ])

      if (groupResult.error?.code === 'PGRST116' || !groupResult.data) {
        sessionStorage.removeItem('tippa-group-id')
        setGroupId(null)
      } else if (groupResult.error || membersResult.error) {
        setAuthError('Kunde inte läsa gruppen.')
      } else {
        setGroup(groupResult.data)
        setGroupMembers(membersResult.data as GroupMember[])
      }
      setGroupLoading(false)
    }

    loadGroup()
  }, [groupId, session])

  useEffect(() => {
    if (!session || !groupId) return
    const userId = session.user.id

    async function loadRound() {
      const { data: roundData } = await supabase.from('rounds').select('id, external_draw_number, label, status, internal_deadline_at, official_close_at, weekly_contribution, captain_user_id').eq('group_id', groupId).in('status', ['open', 'locked']).order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (!roundData) {
        loadedRoundId.current = null
        setRound(null)
        setLiveMatches(null)
        setGroupVotes([])
        setPayments([])
        setLockedSystem(null)
        return
      }

      const { data: matchRows } = await supabase.from('matches').select('id, match_number, home_team, away_team, kickoff_at, venue, match_info, svenska_folket').eq('round_id', roundData.id).order('match_number')
      const nextMatches = (matchRows ?? []).map((match) => {
        const folk = (match.svenska_folket ?? {}) as Partial<Record<Pick, number>>
        return {
          id: match.id,
          number: match.match_number,
          home: match.home_team,
          away: match.away_team,
          kickoff: match.kickoff_at ? new Date(match.kickoff_at).toLocaleString('sv-SE', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'Tid ej satt',
          venue: match.venue,
          info: match.match_info,
          picks: { '1': Number(folk['1'] ?? 0), X: Number(folk.X ?? 0), '2': Number(folk['2'] ?? 0) },
        }
      })

      if (!nextMatches.length) return
      setRound(roundData as Round)
      setLiveMatches(nextMatches)
      if (roundData.status === 'locked') {
        const { data: savedSystem } = await supabase.from('round_systems').select('selections').eq('round_id', roundData.id).maybeSingle()
        setLockedSystem((savedSystem?.selections ?? null) as Record<number, Pick[]> | null)
      } else {
        setLockedSystem(null)
      }

      const [{ data: predictionRows }, { data: allPredictionRows }, { data: paymentRows }] = await Promise.all([
        supabase.from('predictions').select('match_id, selection').eq('round_id', roundData.id).eq('user_id', userId),
        supabase.from('predictions').select('match_id, user_id, selection').eq('round_id', roundData.id),
        supabase.from('payments').select('user_id, amount, status').eq('round_id', roundData.id),
      ])
      const savedByMatch = new Map((predictionRows ?? []).map((prediction) => [prediction.match_id, prediction.selection as Pick]))
      if (loadedRoundId.current !== roundData.id) {
        setSelected(Object.fromEntries(nextMatches.flatMap((match) => { const pick = pendingPicks.current[match.number] ?? savedByMatch.get(match.id ?? ''); return pick ? [[match.number, pick]] : [] })))
        loadedRoundId.current = roundData.id
      }
      setGroupVotes((allPredictionRows ?? []) as GroupVote[])
      setPayments((paymentRows ?? []).map((payment) => ({ ...payment, amount: Number(payment.amount) })) as Payment[])
    }

    void loadRound()
    const refreshOnFocus = () => { void loadRound() }
    window.addEventListener('focus', refreshOnFocus)
    const refreshTimer = window.setInterval(() => { void loadRound() }, 5000)
    return () => {
      window.removeEventListener('focus', refreshOnFocus)
      window.clearInterval(refreshTimer)
    }
  }, [groupId, session, roundRefreshKey])

  async function savePick(match: Match, pick: Pick) {
    if (!round || round.status !== 'open' || !match.id || !session) return
    const previousPick = selected[match.number]
    pendingPicks.current[match.number] = pick
    setSelected((current) => ({ ...current, [match.number]: pick }))
    setGroupVotes((current) => [...current.filter((vote) => !(vote.match_id === match.id && vote.user_id === session.user.id)), { match_id: match.id as string, user_id: session.user.id, selection: pick }])
    const { error } = await supabase.from('predictions').upsert({
      round_id: round.id,
      match_id: match.id,
      user_id: session.user.id,
      selection: pick,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'match_id,user_id' })
    if (error) {
      delete pendingPicks.current[match.number]
      setSelected((current) => {
        const next = { ...current }
        if (previousPick) next[match.number] = previousPick
        else delete next[match.number]
        return next
      })
      setAuthError(`Tipset kunde inte sparas: ${error.message}`)
    } else if (pendingPicks.current[match.number] === pick) {
      delete pendingPicks.current[match.number]
    }
  }

  if (authLoading) return <div className="auth-loading">Laddar Tippa...</div>
  if (!session) return <div className="auth-loading">{authError || 'Kunde inte starta Tippa.'}</div>
  if (!groupId) return <GroupGate onJoined={(joinedGroupId) => { sessionStorage.setItem('tippa-group-id', joinedGroupId); setGroupId(joinedGroupId) }} />
  if (groupLoading) return <div className="auth-loading">Laddar gruppen...</div>
  if (!group) return <div className="auth-loading">{authError || 'Gruppen kunde inte hittas.'}</div>

  const savedCount = Object.keys(selected).length
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark">377</span><span>TIPPA</span><span className="user-identity">Du: {groupMembers.find((member) => member.user_id === session.user.id)?.display_name ?? 'Spelare'}</span></div>
        <button className="icon-button" aria-label="Logga ut" onClick={() => supabase.auth.signOut()}><LogOut size={19} /></button>
      </header>

      <section className="page-heading">
        <div>
          <p className="eyebrow">{group.name.toUpperCase()} · {round?.label ?? 'TESTOMGÅNG'}</p>
          <h1>Veckans system</h1>
        </div>
        <div className="round-badge"><span>STATUS</span><strong>{round?.status === 'locked' ? 'LÅST' : 'ÖPPEN'}</strong></div>
      </section>

      <section className="deadline-bar">
        <Clock3 size={17} /><div><span>Röstningen stänger</span><strong>TOR 23:59</strong></div><ChevronRight size={17} />
      </section>

      {activeSection === 'team' ? <TeamPanel group={group} members={groupMembers} groupId={groupId} round={round} system={system} matches={activeMatches} votes={groupVotes} payments={payments} currentUserId={session.user.id} onRoundChanged={() => setRoundRefreshKey((value) => value + 1)} /> : <>
      <div className="round-layout">
        <div className="personal-round">
        <section className="section-intro"><div><p className="eyebrow">MINA TIPS · {savedCount}/13</p><h2>96-raderssystemet</h2><p>Välj dina tecken. Här ser du folkets fördelning, systemet och lagets röster.</p><p className="system-meta">Kapten: {captain?.display_name ?? 'inte vald'} · avgör vid låsning</p></div><span className="save-state"><Check size={14} /> Sparad</span></section>
        {activeMatches.length ? <div className="match-list">
          <div className="match-list-header"><span>MATCH</span><span>SVENSKA FOLKET</span><span>SYSTEM</span><span>LAGETS RÖSTER</span></div>
          {activeMatches.map((match) => <article className="match-row" key={match.id ?? match.number}>
            <span className="match-number">{String(match.number).padStart(2, '0')}</span>
            <div className="match-info"><strong>{match.home} <b>v</b> {match.away}</strong><small>{match.kickoff}{match.venue ? ` · ${match.venue}` : ''}{match.info ? ` · ${match.info}` : ''}</small></div>
            <div className="pick-group folk-picks" aria-label={`Svenska folkets fördelning för ${match.home} mot ${match.away}`}>
              {(['1', 'X', '2'] as Pick[]).map((pick) => <button key={pick} className={`${selected[match.number] === pick ? 'selected ' : ''}${pick === leadingPick(match.picks) ? 'majority' : ''}`} onClick={() => savePick(match, pick)}>{pick}<small>{match.picks[pick]}</small></button>)}
            </div>
            <div className="system-pick" aria-label={`Gruppens system för match ${match.number}`}><strong>{system.columns[match.number - 1]?.join('') ?? '-'}</strong></div>
            <div className="member-picks">{groupMembers.map((member) => { const vote = groupVotes.find((item) => item.match_id === match.id && item.user_id === member.user_id); return <span key={member.user_id} title={`${member.display_name}: ${vote?.selection ?? 'inte röstat'}`} className={vote ? '' : 'missing'}><b>{member.display_name.slice(0, 2).toUpperCase()}</b>{vote?.selection ?? '-'}</span> })}</div>
          </article>)}
        </div> : <div className="empty-round">Ingen aktiv omgång ännu. Be kaptenen importera veckans matcher.</div>}

        </div>
      </div>
      <TeamInsights matches={activeMatches} members={groupMembers} votes={groupVotes} system={system} />

      </>}

      <footer className="bottom-nav"><button className={activeSection === 'round' ? 'active' : ''} onClick={() => setActiveSection('round')}><Receipt size={18} /><span>Omgång</span></button><button className={activeSection === 'team' ? 'active' : ''} onClick={() => setActiveSection('team')}><Users size={18} /><span>Laget</span></button></footer>
    </main>
  )
}

function GroupGate({ onJoined }: { onJoined: (groupId: string) => void }) {
  const [mode, setMode] = useState<'join' | 'create'>('join')
  const [name, setName] = useState('')
  const [groupName, setGroupName] = useState('')
  const [code, setCode] = useState('14141')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    const result = mode === 'join'
      ? await supabase.rpc('join_group_by_code', { target_code: code, member_name: name })
      : await supabase.rpc('create_group_with_code', { target_name: groupName, target_code: code, member_name: name })

    if (result.error) setError(result.error.message)
    else onJoined(result.data)
    setSubmitting(false)
  }

  return (
    <main className="auth-shell">
      <div className="auth-brand"><span className="brand-mark">377</span><span>TIPPA</span></div>
      <section className="auth-panel">
        <p className="eyebrow">ÖPPEN GRUPP</p>
        <h1>{mode === 'join' ? 'Anslut till gruppen' : 'Skapa en grupp'}</h1>
        <p className="auth-intro">Använd gruppens femsiffriga kod. Ingen e-post och inget lösenord behövs.</p>
        <form onSubmit={handleSubmit}>
          <label>Ditt namn<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Till exempel Jim" required /></label>
          {mode === 'create' && <label>Gruppens namn<input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Till exempel Lördagsgänget" required /></label>}
          <label>Gruppkod<input inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required /></label>
          {error && <p className="auth-error">{error}</p>}
          <button className="primary-button" disabled={submitting}>{submitting ? 'Arbetar...' : mode === 'join' ? 'Anslut till gruppen' : 'Skapa gruppen'} <ChevronRight size={17} /></button>
        </form>
        <button className="auth-switch" onClick={() => { setMode((current) => current === 'join' ? 'create' : 'join'); setError('') }}>
          {mode === 'join' ? 'Skapa en ny grupp' : 'Jag har redan en gruppkod'}
        </button>
      </section>
    </main>
  )
}

function CaptainPanel({ members, groupId, currentUserId, currentDrawNumber, round, system, matches, votes, sessionUserId, onRoundImported }: { members: GroupMember[]; groupId: string; currentUserId: string; currentDrawNumber?: number; round: Round | null; system: { columns: Pick[][]; rows: number }; matches: Match[]; votes: GroupVote[]; sessionUserId: string; onRoundImported: () => void }) {
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [importError, setImportError] = useState('')
  const [locking, setLocking] = useState(false)
  const captain = members.find((member) => member.user_id === round?.captain_user_id) ?? members[0]

  const currentMember = members.find((member) => member.user_id === currentUserId)
  const canImport = Boolean(currentMember?.active && (!round || currentMember.user_id === captain?.user_id))
  const canLock = currentMember?.active && currentMember.user_id === captain?.user_id

  async function importRound(drawNumber?: number) {
    setImporting(true)
    setImportMessage('')
    setImportError('')
    const deadline = new Date()
    deadline.setDate(deadline.getDate() + ((6 - deadline.getDay() + 7) % 7 || 7))
    deadline.setHours(14, 0, 0, 0)

    const { data, error } = await supabase.functions.invoke('import-svenska-spel', {
      body: { groupId, internalDeadlineAt: deadline.toISOString(), ...(drawNumber ? { drawNumber } : {}) },
    })

    if (error) {
      let message = error.message
      if (error.context instanceof Response) {
        try {
          const details = await error.context.json() as { error?: string }
          message = details.error ?? message
        } catch {
          // Keep the client error when the function response is not JSON.
        }
      }
      setImportError(message)
    } else if (data?.error) {
      setImportError(data.error)
    } else {
      setImportMessage(`${data?.importedMatches ?? 13} matcher importerades.`)
      onRoundImported()
    }
    setImporting(false)
  }

  async function lockSystem() {
    if (!round || !canLock) return
    setLocking(true)
    setImportError('')
    const selections = Object.fromEntries(system.columns.map((column, index) => {
      const captainPick = votes.find((vote) => vote.match_id === matches[index]?.id && vote.user_id === captain?.user_id)?.selection
      return [index + 1, column.length > 1 && captainPick && column.includes(captainPick) ? [captainPick] : column]
    }))
    const lockedRowCount = Object.values(selections).reduce((total, column) => total * column.length, 1)
    const { error: systemError } = await supabase.from('round_systems').upsert({
      round_id: round.id,
      selections,
      row_count: lockedRowCount,
      row_cost: 1,
      total_cost: lockedRowCount,
      created_by: sessionUserId,
      locked_at: new Date().toISOString(),
    })
    if (systemError) setImportError(systemError.message)
    else {
      const { error: roundError } = await supabase.from('rounds').update({ status: 'locked' }).eq('id', round.id)
      if (roundError) setImportError(roundError.message)
      else {
        setImportMessage('Systemet är låst och klart för inlämning.')
        onRoundImported()
      }
    }
    setLocking(false)
  }

  async function unlockSystem() {
    if (!round || !canLock) return
    setLocking(true)
    const { error } = await supabase.from('rounds').update({ status: 'open' }).eq('id', round.id)
    if (error) setImportError(error.message)
    else {
      setImportMessage('Systemet är upplåst. Gruppen kan ändra sina tips igen.')
      onRoundImported()
    }
    setLocking(false)
  }

  return <section className="captain-view"><div className="captain-card"><div className="captain-icon"><Crown size={22} /></div><div><p className="eyebrow">VECKANS KAPTEN</p><h2>{captain?.display_name ?? 'Inte vald'}</h2><p>Slumpad för den här omgången. Har utslagsröst och kan låsa systemet.</p></div></div>{canImport && (!round || round.status === 'open') && <><p className="import-note">Kaptenen importerar nästa omgång. Alla kan se och uppdatera aktuell data.</p><button className="primary-button" onClick={() => importRound()} disabled={importing}>{importing ? 'Importerar omgång...' : 'Importera nästa omgång'} <ChevronRight size={17} /></button>{currentDrawNumber && <button className="secondary-button" onClick={() => importRound(currentDrawNumber)} disabled={importing}>Uppdatera omgång {currentDrawNumber} <ChevronRight size={17} /></button>}</>}{round?.status === 'open' && canLock && <button className="primary-button" onClick={lockSystem} disabled={locking}><Lock size={17} />{locking ? 'Låser systemet...' : 'Lås systemet'}</button>}{round?.status === 'locked' && <>{canLock && <button className="secondary-button" onClick={unlockSystem} disabled={locking}><Unlock size={17} />{locking ? 'Öppnar...' : 'Lås upp systemet'}</button>}<p className="auth-message">Systemet är låst. {canLock ? 'Du kan låsa upp det om gruppen behöver ändra något.' : 'Rösterna kan inte ändras just nu.'}</p></>}{importMessage && <p className="auth-message">{importMessage}</p>}{importError && <p className="auth-error">{importError}</p>}</section>
}

function CashPanel({ groupId, round, members, payments, currentUserId, onPaymentsChanged }: { groupId: string; round: Round | null; members: GroupMember[]; payments: Payment[]; currentUserId: string; onPaymentsChanged: () => void }) {
  const [saving, setSaving] = useState<string | null>(null)
  if (!round) return <div className="empty-round">Importera en omgång först för att börja hålla ordning på betalningarna.</div>
  const activeRound = round
  const currentMember = members.find((member) => member.user_id === currentUserId)
  const canConfirm = currentMember?.active && (currentMember.role === 'owner' || currentMember.role === 'admin')

  async function markPaid(member: GroupMember, status: Payment['status']) {
    setSaving(member.user_id)
    const { error } = await supabase.from('payments').upsert({ round_id: activeRound.id, user_id: member.user_id, amount: activeRound.weekly_contribution, status, updated_at: new Date().toISOString() }, { onConflict: 'round_id,user_id' })
    if (!error) onPaymentsChanged()
    setSaving(null)
  }

  return <section className="cash-view"><div className="section-intro"><div><p className="eyebrow">SVENSKA SPEL-LAGET</p><h2>{round.weekly_contribution} kr per person</h2><p>Insatsen läggs i lagets Svenska Spel-kassa. Tippa hanterar inte själva pengarna.</p></div><CircleDollarSign size={22} /></div><div className="member-list">{members.map((member) => { const payment = payments.find((item) => item.user_id === member.user_id); const status = payment?.status ?? 'unpaid'; const isMine = member.user_id === currentUserId; return <div className="payment-row" key={member.user_id}><span className="avatar">{member.display_name.slice(0, 2).toUpperCase()}</span><strong>{member.display_name}</strong><span className={status === 'confirmed' ? 'paid' : 'unpaid'}>{status === 'confirmed' ? 'Insats klar' : status === 'reported' ? 'Anmäld' : 'Saknas'}</span>{isMine && status !== 'confirmed' && <button className="mini-button" onClick={() => markPaid(member, status === 'reported' ? 'unpaid' : 'reported')} disabled={saving === member.user_id}>{status === 'reported' ? 'Markera saknas' : 'Jag har lagt in'}</button>}{canConfirm && member.user_id !== currentUserId && status === 'reported' && <button className="mini-button" onClick={() => markPaid(member, 'confirmed')} disabled={saving === member.user_id}>Bekräfta</button>}</div>})}</div></section>
}

function TeamPanel({ group, members, groupId, round, system, matches, votes, payments, currentUserId, onRoundChanged }: { group: Group; members: GroupMember[]; groupId: string; round: Round | null; system: { columns: Pick[][]; rows: number }; matches: Match[]; votes: GroupVote[]; payments: Payment[]; currentUserId: string; onRoundChanged: () => void }) {
  return <section className="team-view"><div className="group-card"><p className="eyebrow">LAGET</p><h2>{group.name}</h2><p>Fem kompisar, ett gemensamt system och 20 kr var till Svenska Spel-laget.</p><button className="group-code" onClick={async () => navigator.clipboard.writeText(group.join_code)}><span>{group.join_code}</span><small>Kopiera kod</small></button></div><CaptainPanel members={members} groupId={groupId} currentUserId={currentUserId} currentDrawNumber={round?.external_draw_number} round={round} system={system} matches={matches} votes={votes} sessionUserId={currentUserId} onRoundImported={onRoundChanged} /><CashPanel groupId={groupId} round={round} members={members} payments={payments} currentUserId={currentUserId} onPaymentsChanged={onRoundChanged} /></section>
}

function TeamInsights({ matches, members, votes, system }: { matches: Match[]; members: GroupMember[]; votes: GroupVote[]; system: { columns: Pick[][]; rows: number } }) {
  const insights: string[] = []
  const matchData = matches.map((match, index) => {
    const matchVotes = votes.filter((vote) => vote.match_id === match.id)
    const counts = Object.fromEntries(pickOrder.map((pick) => [pick, matchVotes.filter((vote) => vote.selection === pick).length])) as Record<Pick, number>
    return { match, index, matchVotes, counts }
  })

  for (const { match, index, matchVotes, counts } of matchData) {
    if (matchVotes.length < 2) continue
    const ranked = pickOrder.slice().sort((left, right) => counts[right] - counts[left] || pickOrder.indexOf(left) - pickOrder.indexOf(right))
    const leading = ranked[0]
    const second = ranked[1]
    const outliers = matchVotes.filter((vote) => vote.selection !== leading)
    if (outliers.length === 1 && counts[leading] === matchVotes.length - 1) {
      const member = members.find((item) => item.user_id === outliers[0].user_id)
      insights.push(`${member?.display_name ?? 'En i laget'} är ensam om att spela ${outliers[0].selection} i match ${match.number}, ${match.home} mot ${match.away}. De andra tror på ${leading}.`)
    } else if (counts[leading] === matchVotes.length) {
      insights.push(`Alla ${matchVotes.length} röster ligger på ${leading} i match ${match.number}, ${match.home} mot ${match.away}.`)
    } else if (counts[leading] === counts[second] && counts[leading] > 0) {
      insights.push(`Laget delar sig i match ${match.number}, ${match.home} mot ${match.away}: ${leading} och ${second} har lika många röster.`)
    }
    if (system.columns[index]?.length > 1 && insights.length < 5) {
      insights.push(`Systemet garderar match ${match.number}, ${match.home} mot ${match.away}, med ${system.columns[index].join('')}.`)
    }
    if (insights.length >= 5) break
  }

  return <section className="insights-panel"><div className="panel-heading"><div><p className="eyebrow">LAGETS RÖSTER</p><h2>Veckans snackisar</h2></div><span className="snackis-count">{votes.length} tips</span></div>{insights.length ? <div className="insight-list">{insights.slice(0, 5).map((insight, index) => <p key={`${index}-${insight}`}>{insight}</p>)}</div> : <p className="insights-empty">När fler i laget har röstat dyker matchinsikterna upp här.</p>}</section>
}

export default App
