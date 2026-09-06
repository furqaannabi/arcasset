import type { ReactNode } from "react";

/**
 * The shared vocabulary every screen is built from.
 *
 * Two rules carry most of the look, and both are content rules rather than
 * decoration: separation is a hairline, never a shadow — and anything that is
 * a number, an address or a hash is set in mono with tabular figures, because
 * this app is mostly columns of those and they have to line up.
 */

export function Panel({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-card border border-line bg-panel ${padded ? "p-5" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`eyebrow ${className}`}>{children}</p>;
}

/**
 * A section marker carrying its own index — "A / PROVENANCE". The index is
 * information: these are ordered parts of a document, and the letter is how
 * you refer to one out loud.
 */
export function SectionHead({
  index,
  title,
  aside,
}: {
  index: string;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line pb-2">
      <span className="eyebrow shrink-0">{index}</span>
      <h2 className="eyebrow text-ink">{title}</h2>
      {aside ? <div className="ml-auto shrink-0">{aside}</div> : null}
    </div>
  );
}

type ButtonTone = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_TONE: Record<ButtonTone, string> = {
  primary:
    "bg-accent text-accent-ink border-accent hover:opacity-90 disabled:bg-raised disabled:text-faint disabled:border-line",
  secondary:
    "bg-raised text-ink border-line hover:border-line-strong disabled:text-faint",
  ghost: "bg-transparent text-muted border-transparent hover:text-ink",
  danger: "bg-transparent text-danger border-danger/40 hover:border-danger",
};

export function Button({
  tone = "secondary",
  full = false,
  className = "",
  children,
  ...rest
}: {
  tone?: ButtonTone;
  full?: boolean;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`rounded-card border px-3.5 py-2 font-mono text-xs tracking-wide transition-colors disabled:cursor-not-allowed ${
        BUTTON_TONE[tone]
      } ${full ? "w-full" : ""} ${className}`}
    >
      {children}
    </button>
  );
}

type Tone = "neutral" | "accent" | "warn" | "danger";

const DOT_TONE: Record<Tone, string> = {
  neutral: "bg-faint",
  accent: "bg-accent",
  warn: "bg-warn",
  danger: "bg-danger",
};

/** Status as a mark, so state reads before the label is parsed. */
export function Dot({ tone = "neutral" }: { tone?: Tone }) {
  return <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${DOT_TONE[tone]}`} />;
}

const CHIP_TONE: Record<Tone, string> = {
  neutral: "border-line bg-raised text-muted",
  accent: "border-accent/30 bg-accent-faint text-accent",
  warn: "border-warn/30 bg-warn-faint text-warn",
  danger: "border-danger/30 bg-danger-faint text-danger",
};

export function Chip({
  tone = "neutral",
  dot = false,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-card border px-2 py-1 font-mono text-[10.5px] tracking-wide whitespace-nowrap ${CHIP_TONE[tone]}`}
    >
      {dot ? <Dot tone={tone} /> : null}
      {children}
    </span>
  );
}

/**
 * Label above, control below, hint or error underneath — and the error
 * replaces the hint rather than stacking, so the field never grows and shifts
 * everything below it as you type.
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <span className="mt-1.5 block font-mono text-[11px] text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-[11px] leading-relaxed text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-card border border-line bg-raised px-3 py-2 font-mono text-sm text-ink tnum placeholder:text-faint focus:border-line-strong";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

/**
 * An input that sits inside a sentence. Sized to its own content so the line
 * reads as prose with the numbers filled in, rather than as a field with a
 * caption — the terms are a sentence, and a form that looks like one is
 * easier to check than eight labelled boxes.
 */
export function InlineInput({
  value,
  min = 4,
  invalid = false,
  className = "",
  ...rest
}: {
  value: string;
  min?: number;
  invalid?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "size">) {
  return (
    <input
      {...rest}
      value={value}
      // +1ch of slack so the caret never sits on the underline's edge.
      style={{ width: `${Math.max(value.length + 1, min)}ch` }}
      className={`border-b bg-transparent pb-0.5 text-center font-mono tnum text-ink outline-none transition-colors ${
        invalid ? "border-danger" : "border-line-strong focus:border-accent"
      } ${className}`}
    />
  );
}

/**
 * A short closed set as chips rather than a select. Three or four options are
 * faster to compare side by side than behind a dropdown, and the chosen one
 * stays visible.
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`rounded-card border px-2.5 py-1 font-mono text-[11px] transition-colors ${
              active
                ? "border-accent bg-accent-faint text-accent"
                : "border-line bg-raised text-muted hover:border-line-strong hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Defaults nobody usually touches, out of the way but one click from view. */
export function Disclosure({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-card border border-line bg-panel">
      <summary className="eyebrow cursor-pointer list-none px-4 py-3 hover:text-ink">
        <span className="inline-block w-4 transition-transform group-open:rotate-90">›</span>
        {summary}
      </summary>
      <div className="border-t border-line px-4 py-4">{children}</div>
    </details>
  );
}

/** A label/value pair. Values are mono because they are all data. */
export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "accent" | "danger";
}) {
  const color = tone === "accent" ? "text-accent" : tone === "danger" ? "text-danger" : "text-ink";
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className={`mt-1 font-mono text-sm tnum ${color}`}>{value}</p>
    </div>
  );
}

export function Rule() {
  return <hr className="border-0 border-t border-line" />;
}

/**
 * One page header shape everywhere: index and title on the left, the facts
 * that qualify the page on the right. The meta row is where a screen says
 * which chain and which contract it is talking about, so nobody has to guess
 * whether they are looking at testnet.
 */
export function PageHeader({
  index,
  title,
  lede,
  meta,
}: {
  index: string;
  title: ReactNode;
  lede?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="max-w-2xl space-y-3">
          <Eyebrow>{index}</Eyebrow>
          <h1 className="text-2xl font-medium tracking-tight text-balance">{title}</h1>
          {lede ? (
            <p className="text-[13px] leading-relaxed text-muted">{lede}</p>
          ) : null}
        </div>
        {meta ? <div className="flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
    </header>
  );
}
