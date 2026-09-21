import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type JsonRecord = Record<string, unknown>
type NormalizedMatch = {
  matchNumber: number
  externalMatchId: number | null
  homeTeam: string
  awayTeam: string
  kickoffAt: string | null
  venue: string | null
  info: string | null
  result: '1' | 'X' | '2' | null
  svenskaFolket: unknown
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function firstValue(record: JsonRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key]
  }
  return null
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const record = asRecord(value)
    const nested = firstValue(record, ['name', 'displayName', 'value'])
    return typeof nested === 'string' ? nested : null
  }
  return null
}

function asResult(value: unknown): '1' | 'X' | '2' | null {
  const result = String(value ?? '').toUpperCase()
  return result === '1' || result === 'X' || result === '2' ? result : null
}

function normalizeEvent(eventValue: unknown, index: number): NormalizedMatch {
  const event = asRecord(eventValue)
  const home = asRecord(firstValue(event, ['homeTeam', 'home', 'homeParticipant']))
  const away = asRecord(firstValue(event, ['awayTeam', 'away', 'awayParticipant']))
  const matchNumber = Number(firstValue(event, ['matchNumber', 'eventNumber', 'number'])) || index + 1
  const externalMatchId = Number(firstValue(event, ['matchId', 'externalMatchId', 'id'])) || null
  const homeTeam = asText(home) ?? asText(firstValue(event, ['homeTeamName', 'homeName'])) ?? 'Okant hemmalag'
  const awayTeam = asText(away) ?? asText(firstValue(event, ['awayTeamName', 'awayName'])) ?? 'Okant bortalag'
  const kickoff = firstValue(event, ['kickoffAt', 'matchStart', 'startTime', 'kickoff'])
  const venue = asText(firstValue(event, ['venue', 'stadium', 'arena', 'venueName']))
  const info = asText(firstValue(event, ['info', 'matchInfo', 'competition', 'league']))
  const result = asResult(firstValue(event, ['result', 'outcome', 'sign']))
  const svenskaFolket = firstValue(event, ['svenskaFolket', 'publicDistribution', 'folketsFordelning', 'distribution'])

  return {
    matchNumber,
    externalMatchId,
    homeTeam,
    awayTeam,
    kickoffAt: typeof kickoff === 'string' ? kickoff : null,
    venue,
    info,
    result,
    svenskaFolket,
  }
}

function findDraw(payload: unknown, requestedDrawNumber?: number): JsonRecord {
  const root = asRecord(payload)
  const candidates = [
    ...(Array.isArray(root.draws) ? root.draws : []),
    ...(Array.isArray(root.drawEvents) ? [root] : []),
    ...(Array.isArray(asRecord(root.draw).drawEvents) ? [asRecord(root.draw)] : []),
  ].map(asRecord)

  if (requestedDrawNumber) {
    const requested = candidates.find((candidate) => Number(firstValue(candidate, ['drawNumber', 'externalDrawNumber', 'number'])) === requestedDrawNumber)
    if (requested) return requested
  }

  return candidates[0] ?? root
}

function extractEvents(draw: JsonRecord): unknown[] {
  if (Array.isArray(draw.drawEvents)) return draw.drawEvents
  if (Array.isArray(draw.events)) return draw.events
  if (Array.isArray(draw.matches)) return draw.matches
  return []
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Svenska Spel API returned ${response.status}`)
  return response.json()
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const apiUrl = Deno.env.get('SVENSKA_SPEL_API_URL')
    const drawsUrl = Deno.env.get('SVENSKA_SPEL_DRAWS_URL')
    if (!supabaseUrl || !apiUrl) throw new Error('Importer secrets are not configured')

    const authorization = request.headers.get('Authorization')
    if (!authorization) throw new Error('Authorization is required')

    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authorization } } })
    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) throw new Error('A valid signed-in user is required')

    const body = await request.json() as { groupId?: string; drawNumber?: number; internalDeadlineAt?: string }
    if (!body.groupId || !body.internalDeadlineAt) throw new Error('groupId and internalDeadlineAt are required')

    const [{ data: membership, error: membershipError }, { data: group, error: groupError }] = await Promise.all([
      userClient.from('group_members').select('role, active').eq('group_id', body.groupId).eq('user_id', userData.user.id).maybeSingle(),
      userClient.from('groups').select('created_by').eq('id', body.groupId).maybeSingle(),
    ])
    if (membershipError) throw new Error(`Could not read group membership: ${membershipError.message}`)
    if (groupError) throw new Error(`Could not read group: ${groupError.message}`)
    const isGroupCreator = group?.created_by === userData.user.id
    if ((!membership || !membership.active) && !isGroupCreator) throw new Error('Your current user is not an active member of this group')

    let draw: JsonRecord
    if (drawsUrl) {
      try {
        draw = findDraw(await fetchJson(drawsUrl), body.drawNumber)
        if (extractEvents(draw).length !== 13) throw new Error('Draw discovery returned no complete 13-match draw')
      } catch (discoveryError) {
        if (body.drawNumber === undefined) throw discoveryError
        draw = findDraw(await fetchJson(apiUrl), body.drawNumber)
      }
    } else {
      draw = findDraw(await fetchJson(apiUrl), body.drawNumber)
    }
    const events = extractEvents(draw).map(normalizeEvent).sort((left, right) => left.matchNumber - right.matchNumber)
    if (events.length !== 13) throw new Error(`Expected 13 draw events, received ${events.length}`)

    const drawNumber = Number(firstValue(draw, ['drawNumber', 'externalDrawNumber', 'number'])) || null
    const officialCloseAt = firstValue(draw, ['officialCloseAt', 'closingTime', 'closeTime', 'spelstopp'])
    if (drawNumber === null) throw new Error('Svenska Spel API returned no draw number')

    const roundPayload = {
      group_id: body.groupId,
      external_draw_number: drawNumber,
      label: String(firstValue(draw, ['label', 'name']) ?? `Stryktipset ${drawNumber ?? ''}`).trim(),
      status: 'open',
      internal_deadline_at: body.internalDeadlineAt,
      official_close_at: typeof officialCloseAt === 'string' ? officialCloseAt : null,
    }
    const { data: existingRound, error: lookupError } = await userClient.from('rounds').select('id').eq('group_id', body.groupId).eq('external_draw_number', drawNumber).maybeSingle()
    if (lookupError) throw new Error(`Could not find existing round: ${lookupError.message}`)

    let round: { id: string } | null = null
    if (existingRound) {
      const { data: updatedRound, error: updateError } = await userClient.from('rounds').update(roundPayload).eq('id', existingRound.id).select('id').single()
      if (updateError) throw new Error(`Could not update round: ${updateError.message}`)
      round = updatedRound
    } else {
      const { data: insertedRound, error: insertError } = await userClient.from('rounds').insert(roundPayload).select('id').single()
      if (insertError) throw new Error(`Could not create round: ${insertError.message}`)
      round = insertedRound
    }

    const matchRows = events.map((event) => ({
      round_id: round.id,
      match_number: event.matchNumber,
      external_match_id: event.externalMatchId,
      home_team: event.homeTeam,
      away_team: event.awayTeam,
      kickoff_at: event.kickoffAt,
      venue: event.venue,
      match_info: event.info,
      result: event.result,
      svenska_folket: event.svenskaFolket,
    }))
    const { error: matchesError } = await userClient.from('matches').upsert(matchRows, { onConflict: 'round_id,match_number' })
    if (matchesError) throw new Error(`Could not save matches: ${matchesError.message}`)

    return new Response(JSON.stringify({ roundId: round.id, drawNumber, importedMatches: events.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Import failed' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
