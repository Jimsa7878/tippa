# Tippa 377

En mobil först-app för kompisgäng som röstar på veckans Stryktips och bygger ett gemensamt system.

## Teknik

- React + TypeScript + Vite
- Supabase Auth, Postgres, RLS och Edge Functions
- GitHub Pages via GitHub Actions
- Text-tv-inspirerad visuell stil med moderna touchytor

## Lokal start

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Sätt `VITE_SUPABASE_URL` och `VITE_SUPABASE_ANON_KEY` i `.env.local` när Supabase-projektet är skapat.

## Supabase

Kör migrationerna i `supabase/migrations` mot projektet. Frontend ska endast använda Supabase anon key. Service role key får bara användas i Edge Functions och får aldrig läggas i GitHub Pages-builden.

## Svenska Spel-import

API-svaret för en omgång innehåller 13 `drawEvents`, lag, matchstart, spelstopp, resultat, odds och Svenska Folkets fördelning. Importen ska köras server-side via Edge Function, spara en normaliserad kopia och ha manuell fallback om draw discovery eller villkor förändras.

Edge Function-importen finns i `supabase/functions/import-svenska-spel`. Konfigurera följande secrets i Supabase innan deploy:

```text
SVENSKA_SPEL_API_URL=https://...
SVENSKA_SPEL_DRAWS_URL=https://.../draws
```

Deploya funktionen med Supabase CLI:

```powershell
supabase functions deploy import-svenska-spel
```

`SVENSKA_SPEL_DRAWS_URL` är valfri. Om den finns används den för att hitta aktuell komplett omgång; annars används `SVENSKA_SPEL_API_URL` som startpunkt. Importen läser gruppens senast sparade omgång och försöker sedan nästa nummer, exempelvis `4972` efter `4971`. En ny omgång sparas först när exakt 13 matcher har hittats. Anropet kräver en inloggad gruppmedlem och JSON med `groupId` och `internalDeadlineAt`.

## GitHub Pages

Lägg GitHub Actions-secrets `VITE_SUPABASE_URL` och `VITE_SUPABASE_ANON_KEY` i repositoryts `github-pages` environment. Aktivera Pages med GitHub Actions som källa.

## Produktregler i MVP

- Standardgruppen är fem deltagare, men databasen stödjer valfritt maxantal.
- Varje deltagare bidrar med 25 kr per vecka.
- Intern deadline är torsdag 23:59; Svenska Spels officiella spelstopp visas separat och är auktoritativt.
- Kaptenen lämnar in raden manuellt och är utslagsröst.
- Appen lämnar inte automatiskt in spel.
