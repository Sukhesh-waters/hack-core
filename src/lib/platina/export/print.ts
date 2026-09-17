/**
 * Printable rendering of the action packet (Slice 6): one self-contained
 * HTML document — system fonts, a single inline style block, zero external
 * requests, @media print page control. A browser Save-as-PDF produces a
 * faithful copy. All dynamic strings are escaped.
 */
import type { ActionPacket } from "./packet";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const APPROVAL_STEP_LABEL: Record<string, string> = {
  brand_standard_confirmed: "Brand standard confirmed",
  audit_scope_approved: "Audit scope approved",
  direction_approved: "Direction approved",
  ready_for_external_execution: "Ready for external execution",
};

export function renderPacketHtml(packet: ActionPacket): string {
  const scope = [
    packet.affectedScope.division,
    packet.affectedScope.region,
  ]
    .filter(Boolean)
    .join(" · ");

  const evidenceA = packet.evidence.approvedEvidenceRefs
    .map((r) => `<li><code>${esc(r.id)}</code> (${esc(r.kind)})${r.note ? ` — ${esc(r.note)}` : ""}</li>`)
    .join("");
  const evidenceC = packet.evidence.unvalidatedMarketSignalRefs
    .map((r) => `<li><code>${esc(r.id)}</code> (${esc(r.kind)})${r.note ? ` — ${esc(r.note)}` : ""}</li>`)
    .join("");
  const steps = packet.actionSteps
    .map(
      (s) =>
        `<tr><td>${esc(s.title)}</td><td>${esc(s.owner)}</td><td>${esc(
          s.dueDate.slice(0, 10),
        )}</td><td>${s.eventPhase ? esc(s.eventPhase) : "—"}</td><td>${esc(s.status)}</td></tr>`,
    )
    .join("");
  const approvals = packet.approvals
    .map(
      (a) =>
        `<tr><td>${esc(APPROVAL_STEP_LABEL[a.step] ?? a.step)}</td><td>${esc(
          a.decision,
        )}</td><td><code>${esc(a.approverId)}</code></td><td>${esc(
          a.at.slice(0, 10),
        )}</td></tr>`,
    )
    .join("");
  const violations = packet.claimsStatus.blockingViolations
    .map((v) => `<li>${esc(v.rule)} — ${esc(v.why)} (“${esc(v.excerpt)}”)</li>`)
    .join("");
  const exceptions = packet.claimsStatus.exceptions
    .map(
      (e) =>
        `<li>${esc(e.rule)} — ${esc(e.reason)} (approver <code>${esc(
          e.approverId,
        )}</code>, ${esc(e.at.slice(0, 10))})</li>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(packet.title)} — Platina action packet ${packet.packetVersion}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; color: #13212e; margin: 0; }
  main { max-width: 800px; margin: 0 auto; padding: 32px 24px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.12em; color: #005EB8; margin: 28px 0 8px; border-bottom: 1px solid #d4dde6; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px 6px 0; border-bottom: 1px solid #e3e9ef; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #5c6e76; }
  code { font-family: ui-monospace, monospace; font-size: 11px; }
  .meta { color: #5c6e76; font-size: 12px; }
  .banner { border: 1px solid #b03a22; background: #f9e6e1; color: #742316; padding: 10px 14px; font-size: 13px; margin: 16px 0; }
  ul { margin: 6px 0; padding-left: 20px; font-size: 13px; }
  @media print {
    main { padding: 0; }
    h2 { page-break-after: avoid; }
    table, .banner { page-break-inside: avoid; }
    @page { size: A4; margin: 18mm; }
  }
</style>
</head>
<body>
<main>
  <p class="meta">Platina AI OS — action packet v${packet.packetVersion} · ${esc(
    packet.packetId,
  )}</p>
  <h1>${esc(packet.title)}</h1>
  <p class="meta">${esc(scope || "Workspace")} · exported ${esc(
    packet.exportedAt.slice(0, 10),
  )} by ${esc(packet.exportedBy)}</p>

  ${
    packet.unvalidatedDirection
      ? `<p class="banner">Unvalidated direction — this packet rests on no approved evidence. Treat every recommendation as a hypothesis to test.</p>`
      : ""
  }

  <h2>Problem</h2>
  <p>${esc(packet.problemStatement)}</p>
  <p class="meta">Severity ${esc(packet.severity)} · urgency ${esc(
    packet.urgency,
  )}${packet.eventAnchor ? ` · event ${esc(packet.eventAnchor.label)} ${esc(packet.eventAnchor.at.slice(0, 10))}` : ""}</p>

  <h2>What our approved evidence supports</h2>
  <ul>${evidenceA || "<li class='meta'>None cited.</li>"}</ul>

  <h2>What public market signals suggest — not validated</h2>
  <ul>${evidenceC || "<li class='meta'>None cited.</li>"}</ul>

  <h2>Strongest uncertainty</h2>
  <p>${esc(packet.strongestUncertainty)}</p>

  <h2>Action steps</h2>
  <table>
    <thead><tr><th>Step</th><th>Owner</th><th>Due</th><th>Phase</th><th>Status</th></tr></thead>
    <tbody>${steps || "<tr><td colspan='5' class='meta'>No tasks.</td></tr>"}</tbody>
  </table>

  <h2>Expected outcome and measurement</h2>
  <p>${esc(packet.expectedOutcome)}</p>
  <p class="meta">Method: ${esc(
    packet.measurementPlan.method,
  )} · review ${esc(packet.measurementPlan.reviewDate.slice(0, 10))}</p>

  <h2>Claims status</h2>
  <p>${esc(packet.claimsStatus.verdict)}</p>
  ${violations ? `<ul>${violations}</ul>` : ""}
  ${exceptions ? `<h2>Claims exceptions</h2><ul>${exceptions}</ul>` : ""}

  <h2>Approvals</h2>
  <table>
    <thead><tr><th>Step</th><th>Decision</th><th>Approver</th><th>Date</th></tr></thead>
    <tbody>${approvals || "<tr><td colspan='4' class='meta'>No approvals recorded.</td></tr>"}</tbody>
  </table>

  <h2>Provenance</h2>
  <p class="meta">
    Signals: ${packet.provenance.signalDocumentIds.map((i) => `<code>${esc(i)}</code>`).join(" ") || "—"}<br>
    Transcripts: ${packet.provenance.transcriptIds.map((i) => `<code>${esc(i)}</code>`).join(" ") || "—"}<br>
    Hypotheses: ${packet.provenance.brainChunkIds.map((i) => `<code>${esc(i)}</code>`).join(" ") || "—"}<br>
    ${packet.provenance.receiptId ? `Receipt: <code>${esc(packet.provenance.receiptId)}</code><br>` : ""}
    Gate events: ${packet.provenance.gateEventIds.map((i) => `<code>${esc(i)}</code>`).join(" ") || "—"}<br>
    Synthetic demo data excluded: yes
  </p>
</main>
</body>
</html>`;
}
