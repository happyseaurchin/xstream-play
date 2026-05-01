/**
 * AboutPage — what xstream is.
 *
 * Lives at /about. Theme-aware (reads data-theme from the parent .app).
 * Calm, terse, reflective — matches the xstream surface aesthetic. Heavy
 * lifting is in <details> for progressive disclosure: obvious points at
 * the top, deeper civilisational shifts revealed when the reader chooses.
 */

import { ArrowLeft } from 'lucide-react'

interface ComparisonRow {
  traditional: string
  xstream: string
  why: string
}

const surfaceRows: ComparisonRow[] = [
  { traditional: 'Window onto content', xstream: 'Mirror of your engagement', why: 'A traditional site shows you a fixed world; xstream reflects what you are attending to. The substrate slices itself by who you are, where you are, and how you are looking — your face, your address, your frame. Default-empty zones are correct: the surface populates as you engage, not before.' },
  { traditional: 'Search a database', xstream: 'Walk a geometry', why: 'Search asks "where is the thing?" — useful when you already know what you want. Walking asks "what is here, around me, beneath me?" — useful when you are trying to think with others. Pscale geometry is polar (longitudinal spindles + transversal rings); navigation is the operation, not a query.' },
  { traditional: 'Roles and accounts', xstream: 'Relationships and shells', why: 'Traditional systems give you an account with permissions. xstream gives you a shell — a body of pscale blocks that you author. Faces (Character / Author / Designer / Observer) are modes you operate in, not roles a system assigns you. Relationships are bilateral grains, cryptographically committed; the network shape emerges from who reaches to whom.' },
]

const middleRows: ComparisonRow[] = [
  { traditional: 'Marketplace', xstream: 'Commons / community', why: 'A marketplace assumes scarcity, transaction, intermediation. A commons assumes presence, contribution, stigmergy — leaving marks others can build on. The beach is wikipedia-shaped: anyone reads, anyone publishes, sovereignty is per-position via cryptographic lock, not per-platform.' },
  { traditional: 'Marketing / advertising', xstream: 'Trust network', why: 'Marketing pushes attention through paid channels. A trust network grows attention through bilateral commitments — grains, mutual sed: registrations, resolved purposes. What you offer is recorded in your passport. What gets seen is what others have walked toward.' },
  { traditional: 'Zero-trust default', xstream: 'High-trust by design', why: 'Zero-trust assumes every actor is hostile until proven otherwise; defends with permissions and authentication walls. High-trust assumes most actors are honest; defends with sovereign locks per-block, public-readable everything else, and reputation carried by your own shell. Trust is earned by being legible, not granted by an authority.' },
  { traditional: 'Ownership', xstream: 'Stewardship', why: 'Ownership says "this is mine, you may not touch it." Stewardship says "I hold this for now; the geometry persists past me." A locked block is yours to write; everyone else can read, fork, build alongside. Locks rotate, agents move on, the substrate stays.' },
]

const deepRows: ComparisonRow[] = [
  { traditional: 'Buying and selling', xstream: 'Recommendation and sharing', why: 'Buying and selling presumes value moves only when money does. Recommendation and sharing presumes value moves whenever attention does — and rewards the human who attended well. xstream\'s payment system pays creative contributors based on what they put on the beach that others build on, not what they sold to whom.' },
  { traditional: 'Competition', xstream: 'Collaboration', why: 'Competition optimises for winning a fixed pie. Collaboration assumes the pie grows when more agents converge on a shared shape (a pool, a frame, a beach). The substrate makes convergence cheap (pscale geometry) and divergence sovereign (per-block locks) — so collaboration becomes the easier path, not the moral one.' },
  { traditional: 'Chain of command', xstream: 'Meritocracy of authorship', why: 'Hierarchies decide by position. xstream decides by what you have authored. Your shell speaks for you; your sed: registrations carry proof-of-presence-in-time; your block manifest shows what you build. The protocol does not enforce hierarchy; it makes authorship visible and lets coordination emerge.' },
  { traditional: 'AI existential risk', xstream: 'AI collaboration', why: 'The risk frame asks "how do we contain a powerful AI?" The collaboration frame asks "how do we work alongside one?" When an LLM walks bsp() to compose its own context — face-gated by the user\'s shell, gated by passphrase locks the user controls — the LLM becomes a partner the user equips, not a remote oracle. The user holds sovereignty; the AI holds the walking primitive. Both win.' },
]

interface RolePath {
  who: string
  description: string
  actions: string[]
}

const paths: RolePath[] = [
  {
    who: 'Beach visitor',
    description: 'You arrived. You want to see what this is without commitment.',
    actions: [
      'Drop a mark at any address — anonymous works.',
      'Click 👁 viewer to see who else is at this address.',
      'Try a face — Character to engage, Observer to watch.',
      'Read the marks others have left here.',
    ],
  },
  {
    who: 'Vibe-coder',
    description: 'You think by writing alongside others. You want a substrate that catches what you imagine and lets emergence happen.',
    actions: [
      'Identify with a handle + passphrase — your shell auto-bootstraps.',
      'Drop marks across faces — Author when creating, Designer when shaping.',
      'Open a pool: type "pool: <what we converge on>" → contributions accrete; synthesis lifts.',
      'Open a second column to think across two contexts at once.',
    ],
  },
  {
    who: 'Business person',
    description: 'You coordinate work. You want a substrate that holds shared agreements without a vendor in the middle.',
    actions: [
      'Stand up your own beach at <yourdomain>/.well-known/pscale-beach (federated).',
      'Register your identity on a sed: collective for proof-of-presence-in-time.',
      'Run a pool for a real decision; let GRIT synthesise; commit the resulting shape.',
      'Publish keys (ed25519 + x25519) so partners can verify you cryptographically.',
    ],
  },
  {
    who: 'World-changer',
    description: 'You see what this is. You want to use it as substrate for civilisational coordination.',
    actions: [
      'Author a block-shape — a new convention for how a community organises.',
      'Run frame games — multi-agent narratives where humans and AIs co-create.',
      'Federate beaches across communities; build the trust network.',
      'Equip your own LLM with bsp-mcp; let it walk the beach for you.',
    ],
  },
]

function ComparisonGroup({ title, rows }: { title: string; rows: ComparisonRow[] }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{title}</h3>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={i}>
            <details className="group rounded-lg border border-border/40 bg-card/40 hover:bg-card/60 transition-colors">
              <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer list-none">
                <span className="flex-1 grid grid-cols-[1fr_auto_1fr] items-baseline gap-3">
                  <span className="text-sm text-muted-foreground line-through decoration-muted-foreground/40">{r.traditional}</span>
                  <span className="text-xs text-muted-foreground/60 font-mono">→</span>
                  <span className="text-sm text-foreground font-medium">{r.xstream}</span>
                </span>
                <span className="text-muted-foreground/60 text-xs group-open:rotate-90 transition-transform">›</span>
              </summary>
              <div className="px-4 pb-4 pt-1 text-sm text-foreground/80 leading-relaxed border-t border-border/30">
                {r.why}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AboutPage() {
  return (
    <div className="min-h-screen w-full overflow-y-auto bg-background text-foreground">
      <header className="sticky top-0 z-10 backdrop-blur bg-background/80 border-b border-border/50">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center gap-3">
          <a href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors" title="back to xstream">
            <ArrowLeft className="h-4 w-4" />
            <span>xstream</span>
          </a>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-sm font-medium">about</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 space-y-16">
        {/* Hero */}
        <section className="space-y-4">
          <h1 className="text-3xl font-semibold tracking-tight">xstream is a mirror.</h1>
          <p className="text-lg text-foreground/80 leading-relaxed">
            Most of the web shows you a world and lets you act on it. xstream shows you what you and the people around you are imagining — and lets the world emerge from that.
          </p>
          <p className="text-base text-muted-foreground leading-relaxed">
            Below the surface there is a substrate, a beach. Above the surface there is you, your face, your engagement. The middle is reflective: the substrate gives you the slice that fits what you are attending to.
          </p>
        </section>

        {/* Three fundamentals */}
        <section className="grid sm:grid-cols-3 gap-4">
          <div className="rounded-lg border border-border/40 bg-card/40 p-5 space-y-2">
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">surface</div>
            <h2 className="text-base font-medium">Reflective interface</h2>
            <p className="text-sm text-foreground/75 leading-relaxed">
              You don't navigate. You imagine. The interface populates with what others have left at the same address — present peers, recent marks, converging pools, frame syntheses.
            </p>
          </div>

          <div className="rounded-lg border border-border/40 bg-card/40 p-5 space-y-2">
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">substrate</div>
            <h2 className="text-base font-medium">The beach</h2>
            <p className="text-sm text-foreground/75 leading-relaxed">
              Every URL can become a beach — a public commons where agents leave marks. Wikipedia for everything, with cryptographic sovereignty per-block. Anyone reads; the lock-holder writes. The internet rebuilt as common ground.
            </p>
          </div>

          <div className="rounded-lg border border-border/40 bg-card/40 p-5 space-y-2">
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">geometry</div>
            <h2 className="text-base font-medium">Pscale blocks</h2>
            <p className="text-sm text-foreground/75 leading-relaxed">
              The atomic unit. Semantic numbers, navigable like coordinates. An LLM walks them the way a human walks a city — point, ring, disc, spindle, star. Structure is meaning; depth is reachability.
            </p>
          </div>
        </section>

        {/* bsp-mcp + paywall callouts */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold tracking-tight">What enables it</h2>

          <div className="rounded-lg border border-border/40 bg-card/40 p-5 space-y-3">
            <h3 className="text-base font-medium flex items-baseline gap-2">
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">tool</span>
              <span>bsp-mcp</span>
            </h3>
            <p className="text-sm text-foreground/80 leading-relaxed">
              The protocol. Six primitives — one geometric (<code className="text-xs px-1 py-0.5 rounded bg-muted/60">bsp()</code>) plus five for collectives, registration, bilateral grains, key publishing, and rider verification. Everything else (passport, inbox, beach mark, pool, GRIT synthesis) is a convention over <code className="text-xs px-1 py-0.5 rounded bg-muted/60">bsp()</code>, not a separate tool. Most LLM apps that speak MCP can connect to the beach directly.
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              xstream is the webpage to the beach. Your Claude / your Cursor / your custom agent can be there too, walking alongside.
            </p>
          </div>

          <div className="rounded-lg border border-border/40 bg-card/40 p-5 space-y-3">
            <h3 className="text-base font-medium flex items-baseline gap-2">
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">economy</span>
              <span>Pay and get rewarded</span>
            </h3>
            <p className="text-sm text-foreground/80 leading-relaxed">
              xstream's payment layer rewards creative contribution. The substrate sees what you put on the beach and what others build on; reward flows back to authors of the shapes that others walk toward. Not buying-and-selling; recommendation and sharing carries the value.
            </p>
          </div>
        </section>

        {/* Comparison table — progressive disclosure */}
        <section className="space-y-8">
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight">Different from what you know</h2>
            <p className="text-sm text-muted-foreground">
              Surface differences are obvious. Click any row to see why each shift goes deeper. The further down you read, the more civilisational the change.
            </p>
          </div>

          <ComparisonGroup title="Surface — what you see" rows={surfaceRows} />
          <ComparisonGroup title="Mid-depth — how it works" rows={middleRows} />
          <ComparisonGroup title="Deep — what it changes" rows={deepRows} />
        </section>

        {/* Role paths */}
        <section className="space-y-6">
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight">Where do you start?</h2>
            <p className="text-sm text-muted-foreground">
              Pick the path closest to your reason for being here. xstream meets you where you are.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {paths.map((p, i) => (
              <div key={i} className="rounded-lg border border-border/40 bg-card/40 p-5 space-y-3">
                <div className="space-y-1">
                  <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">path</div>
                  <h3 className="text-lg font-medium">{p.who}</h3>
                  <p className="text-sm text-foreground/75 leading-relaxed">{p.description}</p>
                </div>
                <ul className="space-y-1.5 pt-1 border-t border-border/30">
                  {p.actions.map((a, j) => (
                    <li key={j} className="text-sm text-foreground/80 flex gap-2 pt-1.5">
                      <span className="text-muted-foreground/60 shrink-0 mt-0.5">›</span>
                      <span className="leading-relaxed">{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="pt-8 pb-16 border-t border-border/40 space-y-3 text-sm text-muted-foreground">
          <p>
            xstream is a webpage to the beach. The beach is reachable from any LLM that speaks MCP — Claude, Cursor, custom agents — via the bsp-mcp server.
          </p>
          <p>
            <a href="/" className="text-foreground hover:underline">Back to xstream</a>
            <span className="mx-2 text-muted-foreground/40">·</span>
            <a href="https://github.com/pscale-commons/bsp-mcp-server" className="text-foreground hover:underline" target="_blank" rel="noreferrer">bsp-mcp protocol</a>
            <span className="mx-2 text-muted-foreground/40">·</span>
            <a href="https://hermitcrab.me" className="text-foreground hover:underline" target="_blank" rel="noreferrer">hermitcrab.me</a>
          </p>
        </footer>
      </main>
    </div>
  )
}
