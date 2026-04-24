import {
  Presentation,
  PresentationFile,
  column,
  row,
  text,
  fill,
  hug,
  wrap,
  grow,
  fixed,
  rule,
} from "file:///C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const OUTPUT_PATH = "C:/Users/USER/OneDrive/Documents/New project/Archon_Demo_Deck.pptx";
const SLIDE_WIDTH = 1920;
const SLIDE_HEIGHT = 1080;

const palette = {
  title: "#0F172A",
  subtitle: "#334155",
  body: "#1F2937",
  accent: "#0891B2",
  meta: "#64748B",
};

const slides = [
  {
    title: "Archon",
    subtitle: "On-chain work, evaluation, and reputation infrastructure",
    bullets: [
      "Built on Arc using USDC and Circle Nanopayments",
      "Supports humans, teams, and AI agents in one shared workflow",
      "Designed for transparent work execution and verifiable outcomes",
    ],
    visuals: [
      "Visual: clean Archon logo lockup + simple lifecycle ring",
      "Arc + USDC + x402 icons in a single horizontal rail",
      "Background motif: subtle network grid",
    ],
    notes:
      "This is Archon. At a high level, Archon is infrastructure for on-chain work, evaluation, and reputation. We built it on Arc, use USDC for economic flows, and use Circle nanopayments for paid context access. The key idea is simple: work should be more than a final file upload. It should include submission, review, improvement, and economic accountability in one transparent lifecycle.",
  },
  {
    title: "Problem",
    subtitle: "Work platforms track delivery, but not the full value creation process",
    bullets: [
      "Most platforms only reward final output, not meaningful review and iteration",
      "Feedback quality, critique quality, and improvement history are hard to measure",
      "Payments are often trust-based, delayed, or expensive to enforce",
      "AI agents need programmable rails to participate in real work markets",
    ],
    visuals: [
      "Before/after comparison: Web2 gig flow vs Archon lifecycle",
      "Pain-point icons: trust, delay, missing reputation signals",
      "Simple stat callouts area for future benchmark numbers",
    ],
    notes:
      "The core problem is that today’s work marketplaces usually reward only the final deliverable. They do not reliably reward feedback, review quality, or iteration. That creates weak incentives and weak reputation signals. Payment can also be slow or trust-heavy. As AI agents begin doing real work, this gets worse, because agents need explicit programmable economic rules, not informal platform logic.",
  },
  {
    title: "Solution",
    subtitle: "Archon turns work into a complete economic lifecycle",
    bullets: [
      "Tasks, submissions, reveal, critique, build-ons, rewards, and credentials are connected",
      "Each step is on-chain verifiable, not hidden in platform internals",
      "Economic incentives extend beyond delivery into evaluation quality",
      "Same rails for individuals, teams, and autonomous agents",
    ],
    visuals: [
      "Lifecycle wheel with 7 labeled phases",
      "Three participant lanes: Human, Team, Agent",
      "On-chain checkpoint markers at each transition",
    ],
    notes:
      "Our solution is to model work as a lifecycle, not a one-shot transaction. In Archon, task creation, submission, finalist selection, reveal interactions, reward distribution, and credential issuance are linked. This creates transparent economic incentives around quality, not just speed. It also gives AI agents a native way to participate in structured work and evaluation.",
  },
  {
    title: "How Archon Works",
    subtitle: "End-to-end workflow from task posting to payout and credentials",
    bullets: [
      "1) Creator posts task and locks reward funds in USDC",
      "2) Contributors submit deliverables",
      "3) Creator selects finalists",
      "4) Reveal phase opens for critique and build-ons",
      "5) Winners are finalized and claim rewards",
      "6) Credentials and reputation updates are published",
    ],
    visuals: [
      "Horizontal timeline with numbered checkpoints",
      "Color-coded phases: submission, review, reveal, settlement",
      "Small legend for user roles and contract actions",
    ],
    notes:
      "Here is the full operating flow. A creator posts a task and locks USDC. Contributors submit work. The creator selects finalists, then reveal opens. During reveal, participants can critique or build on finalist submissions with stake-backed interactions. After evaluation, winners are finalized, rewards are paid, and credentials update reputation. This gives both technical and non-technical users a clear, auditable process.",
  },
  {
    title: "Reveal Phase",
    subtitle: "Structured peer evaluation with stake-backed accountability",
    bullets: [
      "Finalists become visible during reveal; non-finalist noise is reduced",
      "Participants can submit critiques or build-ons on finalist submissions",
      "Interactions require stake, creating economic accountability",
      "Low-quality or malicious interactions can be slashed",
      "High-signal interactions can contribute to rewards and reputation",
      "Signal map visualizes reveal activity in real time",
    ],
    visuals: [
      "Two-column diagram: Critique path vs Build-on path",
      "Stake in / slash risk / reward potential mini flow",
      "Reveal window badge showing active phase timing",
    ],
    notes:
      "Reveal phase is where Archon differentiates strongly. Before reveal, submissions are hidden. During reveal, finalists are visible and participants can critique or build on them. Those interactions are stake-backed, so low-effort spam has direct economic risk. Good interactions become valuable signal for creators and can improve participant outcomes. This turns evaluation itself into a measurable, incentivized layer.",
  },
  {
    title: "Signal Map",
    subtitle: "A visual layer to interpret evaluation activity quickly",
    bullets: [
      "Each tile represents one finalist submission",
      "Neutral means no interactions received yet",
      "Red means critique-heavy response mix",
      "Green means build-on-heavy response mix",
      "Tile size tracks interaction weight on that submission",
      "Helps creators compare not only outputs, but evaluation dynamics",
    ],
    visuals: [
      "Treemap mockup with neutral, red, and green tiles",
      "Legend: critique-heavy, build-on-heavy, mixed, neutral",
      "Detail panel callout for one selected submission",
    ],
    notes:
      "Signal map is a fast decision support surface. Instead of reading every thread first, creators can see where evaluation activity is concentrated. Each tile is a finalist submission, not a responder wallet. Color reflects the received interaction mix, and size reflects interaction weight. It helps creators prioritize where to inspect deeply and reduces subjective noise in final selection.",
  },
  {
    title: "Agent Participation",
    subtitle: "skill.md defines how agents operate on Archon rails",
    bullets: [
      "Agents use skill.md as the execution guide for protocol interactions",
      "Agents can discover tasks and submit deliverables",
      "Agents can access paid task context through x402",
      "Agents can critique and build on reveal submissions",
      "Agent actions contribute to rewards and reputation outcomes",
    ],
    visuals: [
      "Agent flow diagram: discover -> submit -> reveal -> earn",
      "API + contract call stack view for technical reviewers",
      "Profile card showing agent reputation growth",
    ],
    notes:
      "Archon is built for hybrid participation. Human users and AI agents share the same lifecycle and incentives. The agent operating guide in skill dot md defines discovery, submission, context access, reveal interaction, and reputation paths. This matters because it gives judges and investors a clear answer to how agents move from demo behavior to accountable market behavior.",
  },
  {
    title: "Economic Rails and Architecture",
    subtitle: "Clear separation of settlement, value, access, and authorization",
    bullets: [
      "Arc is the settlement layer for task and reputation state transitions",
      "USDC is the value asset for rewards, staking, and milestone payouts",
      "Circle x402 covers paid task-context API access",
      "EIP-3009 supports signed authorization path for interaction staking",
      "Contracts manage lifecycle, credentials, and milestone escrow",
    ],
    visuals: [
      "Architecture stack diagram with four labeled layers",
      "Arrow map: user actions -> contract calls -> economic outcomes",
      "Boundary note: x402 is access rail, not reward settlement rail",
    ],
    notes:
      "This slide clarifies architecture boundaries. Arc handles settlement. USDC is the value asset. x402 is specifically for paid context access at the API layer. EIP-3009 supports signed authorization for interaction staking. Smart contracts enforce lifecycle and payout logic. This separation improves reliability and auditability, and it helps technical reviewers see where each responsibility lives.",
  },
  {
    title: "Milestone Contracts",
    subtitle: "Structured work agreements with explicit review and timeout behavior",
    bullets: [
      "Creator defines project milestones and funds escrowed amounts in USDC",
      "Freelancer submits deliverable link per milestone",
      "Creator can approve and release funds or dispute",
      "If review window expires without action, freelancer can claim automatically",
      "Supports predictable execution for longer, staged engagements",
    ],
    visuals: [
      "Milestone ladder: M1, M2, M3 with status badges",
      "Decision branch: approve / dispute / timeout claim",
      "Escrow state transitions shown as simple boxes and arrows",
    ],
    notes:
      "Not every work relationship fits a single bounty. Milestone Escrow supports staged agreements with clear governance. Each milestone has funding, submission, and review states. The creator can approve or dispute. If the creator is inactive beyond the review window, the freelancer can claim via timeout path. This reduces counterparty risk and keeps work progressing without manual arbitration bottlenecks.",
  },
  {
    title: "Reputation and Credentials",
    subtitle: "Portable proof of contribution quality, not just activity volume",
    bullets: [
      "Credentials are issued on-chain and publicly verifiable",
      "Reputation points accrue across tasks and community contributions",
      "Signals include delivery, peer evaluation quality, attestations, and governance",
      "Tiering helps route better opportunities to proven contributors",
      "Public profile pages make verification easy for teams and clients",
    ],
    visuals: [
      "Reputation meter with tier bands",
      "Credential badge strip with on-chain verification indicator",
      "Public profile mockup with task history and score trend",
    ],
    notes:
      "Archon reputation is designed to be portable and verifiable. Credentials are on-chain, and scores are shaped by multiple signals, not just submission count. This allows stronger matching between opportunity and contributor quality. For judges, this demonstrates practical trust infrastructure. For builders and investors, it creates long-term value by turning work history into reusable proof across projects.",
  },
  {
    title: "Demo Flow",
    subtitle: "What we show live in the product walkthrough",
    bullets: [
      "Landing page and task discovery",
      "Create task and lock USDC",
      "Submit deliverable from contributor view",
      "Open reveal phase and inspect signal map",
      "Run critique/build-on interaction path",
      "Show x402 paid context access response behavior",
      "Show milestone submit, review, and release path",
      "Open profile and credential verification page",
    ],
    visuals: [
      "Numbered storyboard of UI screens",
      "Live demo checklist with timing marks",
      "Fallback screenshot set for each critical step",
    ],
    notes:
      "This is the live sequence we run. We start at discovery, create a task, submit work, move into reveal, and inspect signal map behavior. Then we show critique or build-on interactions, verify x402 access behavior, demonstrate milestone lifecycle, and close on profile verification. This flow is designed so both non-technical and technical judges can follow the same narrative clearly.",
  },
  {
    title: "Why It Matters",
    subtitle: "Archon is infrastructure for on-chain work economies",
    bullets: [
      "Work becomes programmable and auditable",
      "Evaluation becomes an economic activity, not hidden labor",
      "Reputation becomes verifiable and portable",
      "Agents can participate under accountable market rules",
      "Archon enables credible, scalable coordination for modern work",
    ],
    visuals: [
      "Closing value triangle: Work, Evaluation, Reputation",
      "Ecosystem view: creators, contributors, agents, communities",
      "Call-to-action strip: pilot, integrate, and scale",
    ],
    notes:
      "To close: Archon makes three things programmable together, work, evaluation, and reputation. That shift matters for creator trust, contributor incentives, and agent participation. We are not just adding a feature to freelance tooling. We are building infrastructure for on-chain work markets where value creation is transparent, accountable, and economically aligned across the full lifecycle.",
  },
];

function bulletLines(items, size = 27) {
  return items.map((line) =>
    text(`• ${line}`, {
      width: fill,
      height: hug,
      style: {
        fontSize: size,
        color: palette.body,
      },
    }),
  );
}

function addContentSlide(presentation, slideData, index, total) {
  const slide = presentation.slides.add();

  slide.compose(
    column(
      {
        name: `slide-${index + 1}-root`,
        width: fill,
        height: fill,
        padding: 72,
        gap: 22,
      },
      [
        text(slideData.title, {
          name: `slide-${index + 1}-title`,
          width: fill,
          height: hug,
          style: {
            fontSize: 56,
            bold: true,
            color: palette.title,
          },
        }),
        text(slideData.subtitle, {
          name: `slide-${index + 1}-subtitle`,
          width: wrap(1580),
          height: hug,
          style: {
            fontSize: 28,
            color: palette.subtitle,
          },
        }),
        rule({
          name: `slide-${index + 1}-rule`,
          width: fixed(280),
          stroke: palette.accent,
          weight: 4,
        }),
        row(
          {
            name: `slide-${index + 1}-body`,
            width: fill,
            height: grow(1),
            gap: 40,
          },
          [
            column(
              {
                name: `slide-${index + 1}-left`,
                width: grow(1.55),
                height: fill,
                gap: 14,
              },
              [
                text("Key Points", {
                  width: fill,
                  height: hug,
                  style: {
                    fontSize: 24,
                    bold: true,
                    color: palette.accent,
                  },
                }),
                ...bulletLines(slideData.bullets, 25),
              ],
            ),
            column(
              {
                name: `slide-${index + 1}-right`,
                width: grow(1),
                height: fill,
                gap: 12,
              },
              [
                text("Suggested Visual", {
                  width: fill,
                  height: hug,
                  style: {
                    fontSize: 24,
                    bold: true,
                    color: palette.accent,
                  },
                }),
                ...bulletLines(slideData.visuals, 22),
              ],
            ),
          ],
        ),
        text(`Archon Demo Deck  |  Slide ${index + 1} of ${total}`, {
          width: fill,
          height: hug,
          style: {
            fontSize: 14,
            color: palette.meta,
          },
        }),
      ],
    ),
    {
      frame: { left: 0, top: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
      baseUnit: 8,
    },
  );

  slide.speakerNotes.setText(slideData.notes);
}

async function main() {
  const presentation = Presentation.create({
    slideSize: { width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
  });

  slides.forEach((slideData, index) => {
    addContentSlide(presentation, slideData, index, slides.length);
  });

  const blob = await PresentationFile.exportPptx(presentation);
  await blob.save(OUTPUT_PATH);
  console.log(`Deck generated: ${OUTPUT_PATH}`);
}

await main();
