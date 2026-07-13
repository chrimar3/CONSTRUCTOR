// T012 — mobile-first web client: pipeline board (US-4) + three capture sheets
// (US-1/2/3), a thin client over the HTTP API (CLAUDE.md design). All chrome is
// Greek; every stored enum key renders via src/domain/labels.ts (FR-11). Article I:
// each capture is one-hand completable <30s — big option grids over keyboards,
// ≥44px targets, at most one optional free-text note (lead only). Article II:
// submit stays disabled until next_action is non-blank. The board renders cards
// in API order (needs-attention-first is decided server-side) — no client re-sort.
// Inline styles per plan.md (no CSS framework).

import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Check, ChevronLeft, Euro, Eye, UserPlus } from "lucide-react";
import {
  budgetBandLabel,
  segmentLabel,
  sourceChannelLabel,
  stageLabel,
  temperatureLabel,
} from "../domain/labels";
import { temperature } from "../domain/temperature";
import { formatEuro } from "../domain/recommend";
import { counterNextAction, counterPreview, formatPct, parseAmount } from "./helpers";

// ─── API result shapes (mirror src/db/queries.ts) ────────────────────────────

interface Project {
  id: number;
  builderName: string;
  projectName: string;
  area: string;
  microArea: string;
}

interface Unit {
  id: number;
  unitCode: string;
  askingCurrent: number;
  status: string;
}

interface Card {
  opportunityId: number;
  buyerId: number;
  pseudonym: string;
  unitCode: string | null;
  stage: string;
  temperature: string;
  offerAmount: number | null;
  nextAction: string;
  nextOwner: string;
  updatedAt: string;
}

interface Counters {
  inquiries: number;
  viewings: number;
  offers: number;
  liveOpportunities: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const OPERATORS = ["Χρήστος", "Λωίδα", "Γιολάντα"];
const SOURCE_KEYS = ["spitogatos", "xe", "referral", "walkin", "social"];
const SEGMENT_KEYS = ["first_home", "investor", "upgrader", "foreign"];
const BUDGET_KEYS = ["<150k", "150-250k", "250-400k", "400k+"];
const INTEREST_KEYS = [1, 2, 3, 4, 5];

const TEMP_COLOR: Record<string, string> = {
  hot: "#dc2626",
  warm: "#d97706",
  cold: "#2563eb",
};

const NEXT_ACTION_SUGGESTIONS: Record<"lead" | "viewing" | "offer", string[]> = {
  lead: ["Τηλεφώνημα για ραντεβού", "Προγραμματισμός επίσκεψης", "Αποστολή κατόψεων"],
  viewing: ["Δεύτερη επίσκεψη", "Τηλεφώνημα follow-up", "Αποστολή τιμοκαταλόγου"],
  offer: ["Ενημέρωση εργολάβου", "Τηλεφώνημα στον αγοραστή", "Κλείσιμο ραντεβού υπογραφής"],
};

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Σφάλμα επικοινωνίας με τον διακομιστή");
  }
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || data === null) {
    throw new Error(data?.error ?? "Σφάλμα επικοινωνίας με τον διακομιστή");
  }
  return data;
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const S = {
  page: {
    maxWidth: 520,
    margin: "0 auto",
    minHeight: "100vh",
  } as const,
  sectionLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "#6b7280",
    textTransform: "uppercase" as const,
    letterSpacing: 0.4,
    margin: "0 0 8px 2px",
  },
  gridBtn: (selected: boolean, disabled = false, color = "#111827") =>
    ({
      minHeight: 48,
      padding: "10px 12px",
      borderRadius: 12,
      border: `1.5px solid ${selected ? color : "#d1d5db"}`,
      background: selected ? color : "#ffffff",
      color: selected ? "#ffffff" : "#111827",
      fontSize: 15,
      fontWeight: 600,
      opacity: disabled ? 0.35 : 1,
      textAlign: "center" as const,
      cursor: "pointer",
    }) as const,
  input: {
    width: "100%",
    minHeight: 48,
    padding: "12px 14px",
    borderRadius: 12,
    border: "1.5px solid #d1d5db",
    background: "#ffffff",
    fontSize: 16,
  } as const,
  submit: (enabled: boolean) =>
    ({
      width: "100%",
      minHeight: 56,
      borderRadius: 14,
      border: "none",
      background: enabled ? "#111827" : "#d1d5db",
      color: "#ffffff",
      fontSize: 17,
      fontWeight: 700,
      cursor: enabled ? "pointer" : "default",
    }) as const,
};

// ─── Small building blocks ────────────────────────────────────────────────────

function Field(props: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={S.sectionLabel}>
        {props.label}
        {props.required ? <span style={{ color: "#dc2626" }}> *</span> : null}
      </div>
      {props.children}
    </div>
  );
}

interface Option {
  key: string | number;
  label: string;
  hint?: string;
  color?: string;
  disabled?: boolean;
}

/** Big-tap option grid — a segmented control instead of a keyboard (Article I). */
function OptionGrid(props: {
  options: Option[];
  value: string | number | null;
  onChange: (key: string | number | null) => void;
  columns?: number;
  allowClear?: boolean;
}) {
  const cols = props.columns ?? 2;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8 }}>
      {props.options.map((o) => {
        const selected = props.value === o.key;
        return (
          <button
            key={String(o.key)}
            type="button"
            disabled={o.disabled}
            onClick={() =>
              props.onChange(selected && props.allowClear ? null : o.key)
            }
            style={S.gridBtn(selected, o.disabled, o.color ?? "#111827")}
          >
            <div>{o.label}</div>
            {o.hint ? (
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  marginTop: 2,
                  color: selected ? "#e5e7eb" : "#6b7280",
                }}
              >
                {o.hint}
              </div>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Mandatory next action (Article II): quick-pick chips + free text. */
function NextActionField(props: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
}) {
  return (
    <Field label="Επόμενη ενέργεια" required>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        {props.suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => props.onChange(s)}
            style={{
              minHeight: 44,
              padding: "8px 14px",
              borderRadius: 22,
              border: `1.5px solid ${props.value === s ? "#111827" : "#d1d5db"}`,
              background: props.value === s ? "#111827" : "#ffffff",
              color: props.value === s ? "#ffffff" : "#374151",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {s}
          </button>
        ))}
      </div>
      <input
        style={S.input}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder="π.χ. Τηλεφώνημα την Τρίτη"
      />
    </Field>
  );
}

/** Full-screen capture sheet with back header + sticky submit (one-hand reach). */
function Sheet(props: {
  title: string;
  submitLabel: string;
  canSubmit: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#f4f4f5",
        overflowY: "auto",
        zIndex: 20,
      }}
    >
      <div style={{ ...S.page, padding: "0 16px 140px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "14px 0 18px",
            position: "sticky",
            top: 0,
            background: "#f4f4f5",
            zIndex: 5,
          }}
        >
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Πίσω"
            style={{
              minWidth: 44,
              minHeight: 44,
              border: "none",
              background: "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <ChevronLeft size={26} />
          </button>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{props.title}</h1>
        </div>
        {props.children}
        {props.error ? (
          <div
            style={{
              background: "#fef2f2",
              border: "1.5px solid #fca5a5",
              color: "#b91c1c",
              borderRadius: 12,
              padding: "12px 14px",
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 12,
            }}
          >
            {props.error}
          </div>
        ) : null}
      </div>
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "12px 16px calc(12px + env(safe-area-inset-bottom))",
          background: "rgba(244,244,245,0.96)",
          borderTop: "1px solid #e5e7eb",
        }}
      >
        <div style={{ maxWidth: 520, margin: "0 auto" }}>
          <button
            type="button"
            disabled={!props.canSubmit || props.busy}
            onClick={props.onSubmit}
            style={S.submit(props.canSubmit && !props.busy)}
          >
            {props.busy ? "Αποθήκευση…" : props.submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Capture sheets ───────────────────────────────────────────────────────────

interface SheetProps {
  projectId: number;
  units: Unit[];
  cards: Card[];
  onSaved: (toast: string) => void;
  onClose: () => void;
}

function unitOptions(units: Unit[]): Option[] {
  return units.map((u) => ({
    key: u.id,
    label: u.unitCode,
    hint: formatEuro(u.askingCurrent),
    disabled: u.status !== "live",
  }));
}

function buyerOptions(cards: Card[]): Option[] {
  return cards.map((c) => ({
    key: c.buyerId,
    label: c.pseudonym,
    hint: c.unitCode ?? stageLabel(c.stage),
    color: TEMP_COLOR[c.temperature],
  }));
}

function OperatorField(props: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <Field label="Χειριστής" required>
      <OptionGrid
        columns={3}
        options={OPERATORS.map((o) => ({ key: o, label: o }))}
        value={props.value}
        onChange={(k) => props.onChange(k as string | null)}
      />
    </Field>
  );
}

function LeadSheet(props: SheetProps) {
  const [source, setSource] = useState<string | null>(null);
  const [segment, setSegment] = useState<string | null>(null);
  const [budget, setBudget] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [nextAction, setNextAction] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = source !== null && operator !== null && nextAction.trim().length > 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        projectId: props.projectId,
        sourceChannel: source,
        handledBy: operator,
        nextAction: nextAction.trim(),
      };
      if (segment !== null) body.segment = segment;
      if (budget !== null) body.budgetBand = budget;
      if (unitId !== null) body.focusUnitId = unitId;
      if (note.trim().length > 0) body.note = note.trim();
      const r = await postJson<{ pseudonym: string }>("/leads", body);
      props.onSaved(`Αποθηκεύτηκε ο ενδιαφερόμενος ${r.pseudonym}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Σφάλμα αποθήκευσης");
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Νέος ενδιαφερόμενος"
      submitLabel="Αποθήκευση"
      canSubmit={canSubmit}
      busy={busy}
      error={error}
      onSubmit={submit}
      onClose={props.onClose}
    >
      <Field label="Πηγή" required>
        <OptionGrid
          options={SOURCE_KEYS.map((k) => ({ key: k, label: sourceChannelLabel(k) }))}
          value={source}
          onChange={(k) => setSource(k as string | null)}
        />
      </Field>
      <Field label="Προφίλ">
        <OptionGrid
          allowClear
          options={SEGMENT_KEYS.map((k) => ({ key: k, label: segmentLabel(k) }))}
          value={segment}
          onChange={(k) => setSegment(k as string | null)}
        />
      </Field>
      <Field label="Προϋπολογισμός">
        <OptionGrid
          allowClear
          options={BUDGET_KEYS.map((k) => ({ key: k, label: budgetBandLabel(k) }))}
          value={budget}
          onChange={(k) => setBudget(k as string | null)}
        />
      </Field>
      {props.units.length > 0 ? (
        <Field label="Ακίνητο ενδιαφέροντος">
          <OptionGrid
            allowClear
            columns={3}
            options={unitOptions(props.units)}
            value={unitId}
            onChange={(k) => setUnitId(k as number | null)}
          />
        </Field>
      ) : null}
      <OperatorField value={operator} onChange={setOperator} />
      <NextActionField
        value={nextAction}
        onChange={setNextAction}
        suggestions={NEXT_ACTION_SUGGESTIONS.lead}
      />
      <Field label="Σημείωση (προαιρετική)">
        <input
          style={S.input}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Μία σύντομη σημείωση"
        />
      </Field>
    </Sheet>
  );
}

function ViewingSheet(props: SheetProps) {
  const [buyerId, setBuyerId] = useState<number | null>(null);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [interest, setInterest] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [nextAction, setNextAction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    buyerId !== null && interest !== null && operator !== null && nextAction.trim().length > 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        projectId: props.projectId,
        buyerId,
        interest,
        handledBy: operator,
        nextAction: nextAction.trim(),
      };
      if (unitId !== null) body.unitId = unitId;
      const r = await postJson<{ temperature: string }>("/viewings", body);
      props.onSaved(`Αποθηκεύτηκε η επίσκεψη — ${temperatureLabel(r.temperature)} αγοραστής`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Σφάλμα αποθήκευσης");
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Καταχώριση επίσκεψης"
      submitLabel="Αποθήκευση"
      canSubmit={canSubmit}
      busy={busy}
      error={error}
      onSubmit={submit}
      onClose={props.onClose}
    >
      <Field label="Αγοραστής" required>
        {props.cards.length > 0 ? (
          <OptionGrid
            columns={3}
            options={buyerOptions(props.cards)}
            value={buyerId}
            onChange={(k) => setBuyerId(k as number | null)}
          />
        ) : (
          <div style={{ fontSize: 14, color: "#6b7280" }}>
            Δεν υπάρχουν ενεργοί αγοραστές — καταχώρισε πρώτα ενδιαφερόμενο.
          </div>
        )}
      </Field>
      {props.units.length > 0 ? (
        <Field label="Ακίνητο">
          <OptionGrid
            allowClear
            columns={3}
            options={unitOptions(props.units)}
            value={unitId}
            onChange={(k) => setUnitId(k as number | null)}
          />
        </Field>
      ) : null}
      <Field label="Ενδιαφέρον" required>
        <div style={{ display: "flex", gap: 8 }}>
          {INTEREST_KEYS.map((i) => {
            const t = temperature(i);
            const selected = interest === i;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setInterest(i)}
                style={{
                  flex: 1,
                  minHeight: 56,
                  borderRadius: 12,
                  border: `1.5px solid ${selected ? TEMP_COLOR[t] : "#d1d5db"}`,
                  background: selected ? TEMP_COLOR[t] : "#ffffff",
                  color: selected ? "#ffffff" : TEMP_COLOR[t],
                  fontSize: 20,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                {i}
              </button>
            );
          })}
        </div>
        {interest !== null ? (
          <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600, color: TEMP_COLOR[temperature(interest)] }}>
            {temperatureLabel(temperature(interest))} αγοραστής
          </div>
        ) : null}
      </Field>
      <OperatorField value={operator} onChange={setOperator} />
      <NextActionField
        value={nextAction}
        onChange={setNextAction}
        suggestions={NEXT_ACTION_SUGGESTIONS.viewing}
      />
    </Sheet>
  );
}

function OfferSheet(props: SheetProps) {
  const [buyerId, setBuyerId] = useState<number | null>(null);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [operator, setOperator] = useState<string | null>(null);
  const [nextAction, setNextAction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buyer = props.cards.find((c) => c.buyerId === buyerId) ?? null;
  // Effective unit for the live preview: the tapped unit, else the buyer's focus unit.
  const effectiveUnit =
    props.units.find((u) => u.id === unitId) ??
    props.units.find((u) => buyer !== null && u.unitCode === buyer.unitCode) ??
    null;
  const preview = counterPreview(effectiveUnit?.askingCurrent ?? null, amount);
  const parsed = parseAmount(amount);

  const canSubmit =
    buyerId !== null && parsed !== null && operator !== null && nextAction.trim().length > 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        projectId: props.projectId,
        buyerId,
        amount: parsed,
        handledBy: operator,
        nextAction: nextAction.trim(),
      };
      if (unitId !== null) body.unitId = unitId;
      const r = await postJson<{ counter: { pctBelow: number; suggested: number } | null }>(
        "/offers",
        body,
      );
      props.onSaved(
        r.counter !== null
          ? `Αποθηκεύτηκε η προσφορά — ${formatPct(r.counter.pctBelow)} κάτω από τη ζητούμενη, προτεινόμενη αντιπρόταση ${formatEuro(r.counter.suggested)}`
          : "Αποθηκεύτηκε η προσφορά",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Σφάλμα αποθήκευσης");
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Καταχώριση προσφοράς"
      submitLabel="Αποθήκευση"
      canSubmit={canSubmit}
      busy={busy}
      error={error}
      onSubmit={submit}
      onClose={props.onClose}
    >
      <Field label="Αγοραστής" required>
        {props.cards.length > 0 ? (
          <OptionGrid
            columns={3}
            options={buyerOptions(props.cards)}
            value={buyerId}
            onChange={(k) => setBuyerId(k as number | null)}
          />
        ) : (
          <div style={{ fontSize: 14, color: "#6b7280" }}>
            Δεν υπάρχουν ενεργοί αγοραστές — καταχώρισε πρώτα ενδιαφερόμενο.
          </div>
        )}
      </Field>
      {props.units.length > 0 ? (
        <Field label="Ακίνητο">
          <OptionGrid
            allowClear
            columns={3}
            options={unitOptions(props.units)}
            value={unitId}
            onChange={(k) => setUnitId(k as number | null)}
          />
        </Field>
      ) : null}
      <Field label="Ποσό προσφοράς (€)" required>
        <input
          style={S.input}
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="π.χ. 250.000"
        />
        {parsed !== null ? (
          <div style={{ marginTop: 6, fontSize: 14, fontWeight: 600, color: "#374151" }}>
            = {formatEuro(parsed)}
          </div>
        ) : null}
      </Field>
      {preview !== null && effectiveUnit !== null ? (
        <div
          style={{
            background: "#eff6ff",
            border: "1.5px solid #bfdbfe",
            borderRadius: 12,
            padding: "12px 14px",
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1d4ed8" }}>
            {formatPct(preview.pctBelow)} κάτω από τη ζητούμενη ({formatEuro(effectiveUnit.askingCurrent)})
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#111827", margin: "4px 0 10px" }}>
            Προτεινόμενη αντιπρόταση: {formatEuro(preview.suggested)}
          </div>
          <button
            type="button"
            onClick={() =>
              setNextAction(counterNextAction(preview.suggested, buyer?.pseudonym ?? ""))
            }
            style={{
              minHeight: 44,
              width: "100%",
              borderRadius: 10,
              border: "1.5px solid #1d4ed8",
              background: "#ffffff",
              color: "#1d4ed8",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Ορισμός ως επόμενη ενέργεια
          </button>
        </div>
      ) : null}
      <OperatorField value={operator} onChange={setOperator} />
      <NextActionField
        value={nextAction}
        onChange={setNextAction}
        suggestions={NEXT_ACTION_SUGGESTIONS.offer}
      />
    </Sheet>
  );
}

// ─── Board (US-4) ─────────────────────────────────────────────────────────────

function TemperatureBadge(props: { temperature: string }) {
  const color = TEMP_COLOR[props.temperature] ?? "#6b7280";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 14,
        background: `${color}18`,
        color,
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      <span
        style={{ width: 8, height: 8, borderRadius: 4, background: color, display: "inline-block" }}
      />
      {temperatureLabel(props.temperature)}
    </span>
  );
}

function BoardCard(props: { card: Card }) {
  const c = props.card;
  return (
    <div
      style={{
        background: "#ffffff",
        borderRadius: 16,
        padding: 14,
        marginBottom: 10,
        boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 18, fontWeight: 800 }}>{c.pseudonym}</span>
          {c.unitCode !== null ? (
            <span style={{ fontSize: 14, fontWeight: 600, color: "#6b7280" }}>{c.unitCode}</span>
          ) : null}
        </div>
        <TemperatureBadge temperature={c.temperature} />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 8,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "#374151",
            background: "#f3f4f6",
            borderRadius: 10,
            padding: "4px 10px",
          }}
        >
          {stageLabel(c.stage)}
        </span>
        {c.offerAmount !== null ? (
          <span style={{ fontSize: 15, fontWeight: 800, color: "#111827" }}>
            {formatEuro(c.offerAmount)}
          </span>
        ) : null}
      </div>
      <div
        style={{
          marginTop: 10,
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: 12,
          padding: "10px 12px",
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: "#92400e", letterSpacing: 0.5 }}>
          ΕΠΟΜΕΝΗ ΕΝΕΡΓΕΙΑ
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginTop: 2 }}>
          {c.nextAction}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#92400e", marginTop: 2 }}>
          → {c.nextOwner}
        </div>
      </div>
    </div>
  );
}

function CounterStat(props: { label: string; value: number }) {
  return (
    <div
      style={{
        flex: 1,
        background: "#ffffff",
        borderRadius: 12,
        padding: "10px 8px",
        textAlign: "center",
        boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 800 }}>{props.value}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>{props.label}</div>
    </div>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────────

type View = "board" | "lead" | "viewing" | "offer";

function App() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [counters, setCounters] = useState<Counters | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [view, setView] = useState<View>("board");
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async (pid: number) => {
    const [pipeline, counts, unitRows] = await Promise.all([
      getJson<Card[]>(`/pipeline?project=${pid}`),
      getJson<Counters>(`/counters?project=${pid}`),
      getJson<Unit[]>(`/units?project=${pid}`),
    ]);
    setCards(pipeline); // API order preserved — no client re-sort (US-4)
    setCounters(counts);
    setUnits(unitRows);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const rows = await getJson<Project[]>("/projects");
        setProjects(rows);
        if (rows.length > 0) setProjectId(rows[0]!.id);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Σφάλμα φόρτωσης");
      }
    })();
  }, []);

  useEffect(() => {
    if (projectId === null) return;
    refresh(projectId).catch((e: unknown) => {
      setLoadError(e instanceof Error ? e.message : "Σφάλμα φόρτωσης");
    });
  }, [projectId, refresh]);

  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  function onSaved(message: string) {
    setView("board");
    setToast(message);
    if (projectId !== null) {
      refresh(projectId).catch(() => setLoadError("Σφάλμα ανανέωσης"));
    }
  }

  const project = projects?.find((p) => p.id === projectId) ?? null;

  if (loadError !== null) {
    return (
      <div style={{ ...S.page, padding: 24 }}>
        <h1 style={{ fontSize: 20 }}>Κάτι πήγε στραβά</h1>
        <p style={{ color: "#b91c1c", fontWeight: 600 }}>{loadError}</p>
      </div>
    );
  }

  if (projects === null) {
    return <div style={{ ...S.page, padding: 24, color: "#6b7280" }}>Φόρτωση…</div>;
  }

  if (projects.length === 0) {
    return (
      <div style={{ ...S.page, padding: 24 }}>
        <h1 style={{ fontSize: 20 }}>Δεν υπάρχουν έργα</h1>
        <p style={{ color: "#6b7280" }}>
          Φόρτωσε το αρχικό pipeline με <code>bun run seed</code> και ανανέωσε τη σελίδα.
        </p>
      </div>
    );
  }

  const sheetProps: SheetProps | null =
    projectId === null
      ? null
      : { projectId, units, cards, onSaved, onClose: () => setView("board") };

  return (
    <div style={{ ...S.page, padding: "0 16px 120px" }}>
      {/* Header: project selector + per-project counters */}
      <div style={{ padding: "14px 0 4px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#6b7280", letterSpacing: 0.4 }}>
          CONSTRUCTOR · ΠΩΛΗΣΕΙΣ
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            padding: "10px 0",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {projects.map((p) => {
            const selected = p.id === projectId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setProjectId(p.id)}
                style={{
                  minHeight: 44,
                  padding: "8px 14px",
                  borderRadius: 22,
                  whiteSpace: "nowrap",
                  border: `1.5px solid ${selected ? "#111827" : "#d1d5db"}`,
                  background: selected ? "#111827" : "#ffffff",
                  color: selected ? "#ffffff" : "#111827",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {p.projectName}
              </button>
            );
          })}
        </div>
        {project !== null ? (
          <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 10 }}>
            {project.builderName} · {project.area} · {project.microArea}
          </div>
        ) : null}
        {counters !== null ? (
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <CounterStat label="Ενεργές" value={counters.liveOpportunities} />
            <CounterStat label="Επισκέψεις" value={counters.viewings} />
            <CounterStat label="Προσφορές" value={counters.offers} />
          </div>
        ) : null}
      </div>

      {/* Board: cards in API order (needs-attention-first, server-decided) */}
      {cards.length === 0 ? (
        <div style={{ textAlign: "center", color: "#6b7280", padding: "40px 20px" }}>
          Κανένας ενεργός ενδιαφερόμενος.
          <br />
          Πάτησε «Νέος» για την πρώτη καταχώριση.
        </div>
      ) : (
        cards.map((c) => <BoardCard key={c.opportunityId} card={c} />)
      )}

      {/* Toast — saved confirmation */}
      {toast !== null ? (
        <div
          onClick={() => setToast(null)}
          style={{
            position: "fixed",
            top: 12,
            left: 16,
            right: 16,
            maxWidth: 488,
            margin: "0 auto",
            background: "#065f46",
            color: "#ffffff",
            borderRadius: 12,
            padding: "12px 14px",
            fontSize: 14,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 8,
            zIndex: 30,
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
          }}
        >
          <Check size={18} /> {toast}
        </div>
      ) : null}

      {/* Bottom capture bar — thumb-reach, ≥44px targets */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "10px 16px calc(10px + env(safe-area-inset-bottom))",
          background: "rgba(244,244,245,0.96)",
          borderTop: "1px solid #e5e7eb",
        }}
      >
        <div style={{ maxWidth: 520, margin: "0 auto", display: "flex", gap: 8 }}>
          {(
            [
              { view: "lead", label: "Νέος", icon: <UserPlus size={20} /> },
              { view: "viewing", label: "Επίσκεψη", icon: <Eye size={20} /> },
              { view: "offer", label: "Προσφορά", icon: <Euro size={20} /> },
            ] as const
          ).map((b) => (
            <button
              key={b.view}
              type="button"
              onClick={() => setView(b.view)}
              style={{
                flex: 1,
                minHeight: 56,
                borderRadius: 14,
                border: "none",
                background: "#111827",
                color: "#ffffff",
                fontSize: 15,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                cursor: "pointer",
              }}
            >
              {b.icon} {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* Capture sheets — mounted fresh per open so state always resets */}
      {view === "lead" && sheetProps !== null ? <LeadSheet {...sheetProps} /> : null}
      {view === "viewing" && sheetProps !== null ? <ViewingSheet {...sheetProps} /> : null}
      {view === "offer" && sheetProps !== null ? <OfferSheet {...sheetProps} /> : null}
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl !== null) {
  createRoot(rootEl).render(<App />);
}
