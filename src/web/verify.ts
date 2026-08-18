import { verifyPondArtifacts, type PondVerification, type VerificationCheck } from './state-verifier'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const form = $<HTMLFormElement>('verify-form')
const input = $<HTMLInputElement>('user')
const button = $<HTMLButtonElement>('verify-button')
const status = $<HTMLParagraphElement>('status')
const result = $<HTMLElement>('result')
const verdict = $<HTMLElement>('verdict')
const verdictTitle = $<HTMLElement>('verdict-title')
const verdictDetail = $<HTMLElement>('verdict-detail')
const facts = $<HTMLElement>('facts')
const checks = $<HTMLElement>('checks')
const fish = $<HTMLElement>('fish')
const artifactLinks = $<HTMLElement>('artifact-links')

const RELEASE_URL = 'https://raw.githubusercontent.com/pillowtalk-Qy/koi-almanac/main/release.json'
const USERNAME = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i

interface ArtifactSet {
  state: unknown
  provenance: unknown
  stateURL: string
  svgURL: string
}

async function fetchText(url: string, maximumCharacters = 2_000_000): Promise<string> {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const text = await response.text()
  if (text.length === 0 || text.length > maximumCharacters) throw new Error('The public artifact has an unexpected size')
  return text
}

function provenanceFromSVG(svg: string): unknown {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
  if (document.querySelector('parsererror')) throw new Error('The published SVG is malformed')
  const metadata = document.getElementById('koipond-provenance')?.textContent
  if (!metadata) throw new Error('The published SVG has no provenance metadata')
  return JSON.parse(metadata)
}

async function retrieveArtifacts(user: string): Promise<ArtifactSet> {
  const base = `https://raw.githubusercontent.com/${encodeURIComponent(user)}/${encodeURIComponent(user)}/output`
  const stateURL = `${base}/pond-state.json`
  const svgURL = `${base}/koi-almanac.svg`
  const [stateText, svg] = await Promise.all([fetchText(stateURL, 1_000_000), fetchText(svgURL)])
  return {
    state: JSON.parse(stateText),
    provenance: provenanceFromSVG(svg),
    stateURL,
    svgURL,
  }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function shortDigest(value: string) {
  return value.length > 24 ? `${value.slice(0, 12)}...${value.slice(-12)}` : value
}

function renderCheck(check: VerificationCheck) {
  const row = element('li', `check check-${check.status}`)
  const marker = element('span', 'check-marker')
  marker.setAttribute('aria-hidden', 'true')
  const copy = element('div', 'check-copy')
  const heading = element('div', 'check-heading')
  heading.append(element('strong', '', check.title), element('span', 'check-status', check.status))
  copy.append(heading, element('p', '', check.detail))
  if (check.value) {
    const code = element('code', '', shortDigest(check.value))
    code.title = check.value
    copy.append(code)
  }
  row.append(marker, copy)
  return row
}

function renderFacts(verification: PondVerification) {
  const state = verification.state
  if (!state) return
  const entries = [
    ['owner', state.owner],
    ['revision', String(state.revision)],
    ['updated', state.updatedOn],
    ['fish', String(state.fish.length)],
    ['snapshot days', String(Object.keys(state.snapshot).length)],
  ]
  facts.replaceChildren(...entries.flatMap(([term, value]) => [element('dt', '', term), element('dd', '', value)]))
  fish.replaceChildren(...state.fish.map(entry => {
    const row = element('li', 'fish-row')
    const identity = element('div')
    identity.append(element('strong', '', entry.species), element('code', '', entry.key))
    const history = element('span', '', `born ${entry.bornOn} · last fed ${entry.lastFedOn} · energy ${entry.lifetimeEnergy}`)
    row.append(identity, history)
    return row
  }))
}

function link(label: string, href: string) {
  const anchor = element('a', '', label)
  anchor.href = href
  anchor.target = '_blank'
  anchor.rel = 'noopener'
  return anchor
}

function renderResult(user: string, verification: PondVerification, artifacts: ArtifactSet) {
  result.hidden = false
  verdict.dataset.verdict = verification.valid ? 'valid' : 'invalid'
  verdictTitle.textContent = verification.valid ? 'Verified locally' : 'Verification failed'
  verdictDetail.textContent = verification.valid
    ? `Revision ${verification.state?.revision} is internally consistent and bound to its published SVG and generator.`
    : 'One or more cryptographic or provenance checks failed. Do not trust this pond state.'
  checks.replaceChildren(...verification.checks.map(renderCheck))
  renderFacts(verification)
  const generator = verification.state?.generator
  artifactLinks.replaceChildren(
    link('state JSON', artifacts.stateURL),
    link('animated SVG', artifacts.svgURL),
    link('release manifest', RELEASE_URL),
    ...(generator ? [link('generator source', `https://github.com/${generator.repository}/tree/${generator.sha}`)] : []),
    link('open pond', `./?user=${encodeURIComponent(user)}`),
  )
}

async function verify(user: string) {
  if (!USERNAME.test(user)) {
    status.dataset.tone = 'error'
    status.textContent = 'Enter a valid GitHub username.'
    result.hidden = true
    return
  }
  button.disabled = true
  form.setAttribute('aria-busy', 'true')
  status.removeAttribute('data-tone')
  status.textContent = 'Retrieving public artifacts and recomputing SHA-256 locally...'
  try {
    const [artifacts, release] = await Promise.all([retrieveArtifacts(user), fetchText(RELEASE_URL, 100_000).then(JSON.parse)])
    const verification = await verifyPondArtifacts(artifacts.state, artifacts.provenance, release)
    renderResult(user, verification, artifacts)
    history.replaceState(null, '', `?user=${encodeURIComponent(user)}`)
    status.textContent = verification.valid ? 'All available cryptographic checks completed.' : 'Verification completed with failures.'
    status.dataset.tone = verification.valid ? 'success' : 'error'
  } catch (error) {
    result.hidden = true
    status.dataset.tone = 'error'
    status.textContent = `Could not verify ${user}: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    button.disabled = false
    form.removeAttribute('aria-busy')
  }
}

form.addEventListener('submit', event => {
  event.preventDefault()
  const user = input.value.trim()
  if (user) void verify(user)
})

const preset = new URLSearchParams(location.search).get('user')
if (preset) {
  input.value = preset
  void verify(preset)
}
