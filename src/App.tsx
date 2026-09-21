import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, ChevronRight, CircleDollarSign, Clock3, Crown, LogOut, Menu, Receipt, Users } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

type Pick = '1' | 'X' | '2'
type Match = { number: number; home: string; away: string; kickoff: string; picks: Record<Pick, number>; mine?: Pick }
type Group = { id: string; name: string; join_code: string; max_members: number }
type GroupMember = { user_id: string; display_name: string; role: 'owner' | 'admin' | 'member'; active: boolean }

const matches: Match[] = [
  { number: 1, home: 'Nottingham', away: 'Coventry', kickoff: 'Lör 18:30', picks: { '1': 3, X: 1, '2': 1 }, mine: '1' },
  { number: 2, home: 'Brighton', away: 'Arsenal', kickoff: 'Lör 16:00', picks: { '1': 1, X: 1, '2': 3 }, mine: '2' },
  { number: 3, home: 'Everton', away: 'Ipswich', kickoff: 'Lör 16:00', picks: { '1': 4, X: 1, '2': 0 }, mine: '1' },
  { number: 4, home: 'Newcastle', away: 'Hull', kickoff: 'Lör 16:00', picks: { '1': 3, X: 1, '2': 1 }, mine: '1' },
  { number: 5, home: 'Birmingham', away: 'Middlesbrough', kickoff: 'Lör 16:00', picks: { '1': 1, X: 2, '2': 2 }, mine: 'X' },
  { number: 6, home: 'Burnley', away: 'Derby', kickoff: 'Lör 16:00', picks: { '1': 3, X: 1, '2': 1 }, mine: '1' },
  { number: 7, home: 'Lincoln', away: 'Swansea', kickoff: 'Lör 16:00', picks: { '1': 1, X: 2, '2': 2 }, mine: 'X' },
  { number: 8, home: 'Portsmouth', away: 'Blackburn', kickoff: 'Lör 16:00', picks: { '1': 2, X: 2, '2': 1 }, mine: '1' },
  { number: 9, home: 'QPR', away: 'Preston', kickoff: 'Lör 16:00', picks: { '1': 4, X: 1, '2': 0 }, mine: '1' },
  { number: 10, home: 'Wrexham', away: 'Southampton', kickoff: 'Lör 16:00', picks: { '1': 2, X: 1, '2': 2 }, mine: 'X' },
  { number: 11, home: 'Luton', away: 'Bradford', kickoff: 'Lör 16:00', picks: { '1': 2, X: 2, '2': 1 }, mine: 'X' },
  { number: 12, home: 'Oxford', away: 'Cambridge', kickoff: 'Lör 16:00', picks: { '1': 2, X: 2, '2': 1 }, mine: '1' },
  { number: 13, home: 'Sheffield W', away: 'Stockport', kickoff: 'Lör 16:00', picks: { '1': 1, X: 1, '2': 3 }, mine: '2' },
]

function leadingPick(picks: Record<Pick, number>): Pick {
  return (Object.entries(picks).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'X') as Pick
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [groupId, setGroupId] = useState(() => sessionStorage.getItem('tippa-group-id'))
  const [group, setGroup] = useState<Group | null>(null)
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([])
  const [groupLoading, setGroupLoading] = useState(false)
  const [activeSection, setActiveSection] = useState<'round' | 'group' | 'cash'>('round')
  const [activeTab, setActiveTab] = useState<'tips' | 'captain'>('tips')
  const [selected, setSelected] = useState<Record<number, Pick>>(
    Object.fromEntries(matches.map((match) => [match.number, match.mine ?? leadingPick(match.picks)])),
  )

  const system = useMemo(() => {
    const columns = matches.map((match) => {
      const ordered = Object.entries(match.picks).sort(([, a], [, b]) => b - a) as [Pick, number][]
      if (ordered[0][1] - ordered[1][1] >= 2) return [ordered[0][0]]
      if (ordered[0][1] === ordered[2][1]) return ['1', 'X', '2'] as Pick[]
      return ordered.slice(0, 2).map(([pick]) => pick)
    })
    return { columns, rows: columns.reduce((total, column) => total * column.length, 1) }
  }, [])

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

  if (authLoading) return <div className="auth-loading">Laddar Tippa...</div>
  if (!session) return <div className="auth-loading">{authError || 'Kunde inte starta Tippa.'}</div>
  if (!groupId) return <GroupGate onJoined={(joinedGroupId) => { sessionStorage.setItem('tippa-group-id', joinedGroupId); setGroupId(joinedGroupId) }} />
  if (groupLoading) return <div className="auth-loading">Laddar gruppen...</div>
  if (!group) return <div className="auth-loading">{authError || 'Gruppen kunde inte hittas.'}</div>

  const savedCount = Object.keys(selected).length
  const cost = Math.max(1, Math.ceil(system.rows / 2))

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark">377</span><span>TIPPA</span></div>
        <button className="icon-button" aria-label="Logga ut" onClick={() => supabase.auth.signOut()}><LogOut size={19} /></button>
      </header>

      <section className="page-heading">
        <div>
          <p className="eyebrow">{group.name.toUpperCase()} · VECKA 38</p>
          <h1>Veckans system</h1>
        </div>
        <div className="round-badge"><span>STATUS</span><strong>ÖPPEN</strong></div>
      </section>

      <section className="deadline-bar">
        <Clock3 size={17} /><div><span>Röstningen stänger</span><strong>TOR 23:59</strong></div><ChevronRight size={17} />
      </section>

      {activeSection === 'group' ? <GroupPanel group={group} members={groupMembers} /> : <>
      <nav className="tabs" aria-label="Sektioner">
        <button className={activeTab === 'tips' ? 'active' : ''} onClick={() => setActiveTab('tips')}>MINA TECKEN <span>{savedCount}/13</span></button>
        <button className={activeTab === 'captain' ? 'active' : ''} onClick={() => setActiveTab('captain')}>KAPTEN <span><Crown size={13} /></span></button>
      </nav>

      {activeTab === 'tips' ? <>
        <section className="section-intro"><div><h2>Din rad</h2><p>Välj ett tecken per match. Ändra fritt fram till deadline.</p></div><span className="save-state"><Check size={14} /> Sparad</span></section>
        <div className="match-list">
          {matches.map((match) => <article className="match-row" key={match.number}>
            <span className="match-number">{String(match.number).padStart(2, '0')}</span>
            <div className="match-info"><strong>{match.home}</strong><span>{match.away}</span><small>{match.kickoff}</small></div>
            <div className="pick-group" aria-label={`Välj tecken för ${match.home} mot ${match.away}`}>
              {(['1', 'X', '2'] as Pick[]).map((pick) => <button key={pick} className={`${selected[match.number] === pick ? 'selected ' : ''}${pick === leadingPick(match.picks) ? 'majority' : ''}`} onClick={() => setSelected((current) => ({ ...current, [match.number]: pick }))}>{pick}<small>{match.picks[pick]}</small></button>)}
            </div>
          </article>)}
        </div>
      </> : <CaptainPanel members={groupMembers} />}

      <section className="system-panel">
        <div className="panel-heading"><div><p className="eyebrow">LIVE FRÅN GRUPPEN</p><h2>Systembygget</h2></div><Receipt size={20} /></div>
        <div className="system-summary"><strong>{system.rows} <span>rader</span></strong><div><span>Beräknad insats</span><b>{cost} kr</b></div></div>
        <div className="coverage"><span>Gruppens täckning</span><div className="coverage-track"><i style={{ width: '76%' }} /></div><b>76%</b></div>
        <p className="system-note">Spikar på majoriteten, gardering där gruppen tvekar. Kaptenen avgör vid lika röst.</p>
      </section>

      </>}

      <footer className="bottom-nav"><button className={activeSection === 'round' ? 'active' : ''} onClick={() => setActiveSection('round')}><Receipt size={18} /><span>Omgång</span></button><button className={activeSection === 'group' ? 'active' : ''} onClick={() => setActiveSection('group')}><Users size={18} /><span>Gruppen</span></button><button className={activeSection === 'cash' ? 'active' : ''} onClick={() => setActiveSection('cash')}><CircleDollarSign size={18} /><span>Kassa</span></button></footer>
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

function CaptainPanel({ members }: { members: GroupMember[] }) {
  const captain = members.find((member) => member.role === 'owner') ?? members[0]
  return <section className="captain-view"><div className="captain-card"><div className="captain-icon"><Crown size={22} /></div><div><p className="eyebrow">VECKANS KAPTEN</p><h2>{captain?.display_name ?? 'Inte vald'}</h2><p>Utslagsröst när gruppen inte är överens.</p></div></div><h3>Gruppens status</h3><div className="member-list">{members.map((member) => <div className="member-row" key={member.user_id}><span className="avatar">{member.display_name.slice(0, 2).toUpperCase()}</span><strong>{member.display_name}</strong><span className="status done">Aktiv</span><span className="paid">{member.role === 'owner' ? 'Kapten' : 'Medlem'}</span></div>)}</div><button className="primary-button">Visa systemförslag <ChevronRight size={17} /></button></section>
}

function GroupPanel({ group, members }: { group: Group; members: GroupMember[] }) {
  const [copied, setCopied] = useState(false)

  async function copyCode() {
    await navigator.clipboard.writeText(group.join_code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return <section className="group-view"><div className="group-card"><p className="eyebrow">ÖPPEN GRUPP</p><h2>{group.name}</h2><p>Skicka koden till kompisarna så kan de ansluta.</p><button className="group-code" onClick={copyCode}><span>{group.join_code}</span><small>{copied ? 'Kopierad' : 'Kopiera kod'}</small></button></div><h3>{members.length} / {group.max_members} deltagare</h3><div className="member-list">{members.map((member) => <div className="member-row" key={member.user_id}><span className="avatar">{member.display_name.slice(0, 2).toUpperCase()}</span><strong>{member.display_name}</strong><span className="paid">{member.role === 'owner' ? 'Ägare' : 'Medlem'}</span></div>)}</div></section>
}

export default App
