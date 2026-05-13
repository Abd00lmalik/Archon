import {
  Presentation,
  PresentationFile,
  column,
  text,
  fill,
  wrap,
  hug,
  fixed,
  rule,
} from "file:///C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const presentation = Presentation.create({ slideSize: { width: 1920, height: 1080 } });
const slide = presentation.slides.add();
slide.compose(
  column(
    { width: fill, height: fill, padding: 72, gap: 24 },
    [
      text("Archon", { width: fill, height: hug, style: { fontSize: 64, bold: true, color: "#0F172A" } }),
      rule({ width: fixed(240), stroke: "#0891B2", weight: 4 }),
      text("On-chain work, evaluation, and reputation infrastructure.", {
        width: wrap(1200),
        height: hug,
        style: { fontSize: 30, color: "#334155" },
      }),
    ],
  ),
  { frame: { left: 0, top: 0, width: 1920, height: 1080 }, baseUnit: 8 }
);
slide.speakerNotes.setText("Test notes");

const out = await PresentationFile.exportPptx(presentation);
await out.save("C:/Users/USER/OneDrive/Documents/New project/Archon_Deck_Test.pptx");
console.log("saved");
