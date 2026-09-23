import Link from "next/link";
import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { PendingButton } from "@/components/platina/pending-button";
import { listBrands, listEvents, listWorkspaceEventParticipants } from "@/db/queries/platina";
import { buildRadar, COUNTRY_POINTS, project, type RadarEvent } from "@/lib/platina/events-view";
import { cn } from "@/lib/utils";
import { createPlanAction } from "../plan/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Events" };

const card = "rounded-lg border border-border bg-card p-4";
const heading = "font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground";
const chip = "rounded-full border px-2.5 py-0.5 text-xs";

const MAP_W = 1000;
const MAP_H = 500;

function when(e: RadarEvent): string {
  if (!e.startsOn) return "date not announced";
  const range = e.dateText ?? (e.endsOn && e.endsOn !== e.startsOn ? `${e.startsOn} to ${e.endsOn}` : e.startsOn);
  if (e.daysLeft === null) return range;
  return e.daysLeft > 0 ? `${range} · in ${e.daysLeft} day${e.daysLeft === 1 ? "" : "s"}` : `${range} · on now`;
}

function Going({ e }: { e: RadarEvent }) {
  if (e.going.length === 0) {
    return <p className="mt-2 text-xs text-muted-foreground">No company named yet on what we read (not proof of absence).</p>;
  }
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {e.going.map((g) => (
        <li key={g.brandId}>
          <a
            href={g.proof}
            target="_blank"
            rel="noopener noreferrer"
            title={`${g.name} ${g.how}`}
            className={cn(
              chip,
              "inline-block hover:bg-accent",
              g.role === "client" ? "border-primary/50 text-primary" : "border-border text-foreground",
            )}
          >
            {g.name} · {g.how} ↗
          </a>
        </li>
      ))}
    </ul>
  );
}

function EventRow({ e, ws, clientId }: { e: RadarEvent; ws: string; clientId: string | null }) {
  return (
    <li className={card}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">
            {e.gulf ? <span className="mr-1 text-primary" title="Gulf">★</span> : null}
            {e.name}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {when(e)} · {e.place ?? "place not stated"}
            {e.country ? ` (${e.country}${e.placeFromCalendar ? ", from the conference calendar" : ""})` : ""}
          </p>
          {e.alsoKnownAs.length > 0 ? (
            <p className="text-[11px] text-muted-foreground">Also read as: {e.alsoKnownAs.join(", ")}</p>
          ) : null}
        </div>
        <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline-offset-4 hover:underline">
          Source ↗
        </a>
      </div>
      <Going e={e} />
      {clientId && e.startsOn && (e.daysLeft ?? 0) > 0 && !e.online ? (
        <form action={createPlanAction} className="mt-3">
          <input type="hidden" name="workspaceId" value={ws} />
          <input type="hidden" name="brandId" value={clientId} />
          <input type="hidden" name="useCase" value="event" />
          <input type="hidden" name="eventName" value={e.name.slice(0, 120)} />
          <input type="hidden" name="eventDate" value={e.startsOn} />
          <PendingButton pendingLabel="Planning…">Plan backwards from the date</PendingButton>
        </form>
      ) : null}
    </li>
  );
}

function WorldMap({ countries }: { countries: { country: string; events: number; gulf: boolean }[] }) {
  const placed = countries.filter((c) => COUNTRY_POINTS[c.country]);
  const unplaced = countries.filter((c) => !COUNTRY_POINTS[c.country]);
  const max = Math.max(1, ...placed.map((c) => c.events));
  return (
    <figure className={cn(card, "p-2")}>
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label="Where the upcoming in-person events are" className="h-auto w-full">
        <rect width={MAP_W} height={MAP_H} rx={12} className="fill-muted/40" />
        {[-60, -30, 0, 30, 60].map((lat) => {
          const { y } = project([0, lat], MAP_W, MAP_H);
          return <line key={`lat${lat}`} x1={0} x2={MAP_W} y1={y} y2={y} className="stroke-border" strokeWidth={lat === 0 ? 1.5 : 0.75} />;
        })}
        {[-120, -60, 0, 60, 120].map((lon) => {
          const { x } = project([lon, 0], MAP_W, MAP_H);
          return <line key={`lon${lon}`} x1={x} x2={x} y1={0} y2={MAP_H} className="stroke-border" strokeWidth={0.75} />;
        })}
        {placed.map((c) => {
          const { x, y } = project(COUNTRY_POINTS[c.country], MAP_W, MAP_H);
          const r = 6 + (14 * c.events) / max;
          return (
            <g key={c.country}>
              <circle cx={x} cy={y} r={r + 6} className={cn(c.gulf ? "fill-primary/15" : "fill-brand-sky/10")} />
              <circle cx={x} cy={y} r={r} className={cn(c.gulf ? "fill-primary" : "fill-brand-sky/70")} />
              <text x={x} y={y - r - 6} textAnchor="middle" className="fill-foreground text-[14px] font-medium">
                {c.country} · {c.events}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="px-2 pb-1 pt-2 text-xs text-muted-foreground">
        One dot per country, sized by upcoming in-person events; Gulf in blue.
        {unplaced.length > 0 ? ` Also: ${unplaced.map((c) => `${c.country} (${c.events})`).join(", ")}.` : ""}
      </figcaption>
    </figure>
  );
}

/**
 * Events radar: every upcoming show and session read from conference pages,
 * competitors' posts and the client's own posts, Gulf first, each with who is
 * going and the proof. Stored facts only; no model call on load.
 */
export default async function EventsPage(props: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { ws } = await props.params;
  const { error } = await props.searchParams;
  const [events, participants, brands] = await Promise.all([
    listEvents(ws),
    listWorkspaceEventParticipants(ws),
    listBrands(ws),
  ]);
  const radar = buildRadar({ events, participants, brands, now: new Date() });
  const client = brands.find((b) => b.kind === "own_brand" && b.status === "active") ?? null;
  const s = radar.spotlight;

  return (
    <PlatinaPage
      eyebrow="Watch"
      title="Events radar"
      description="Where the market gathers in person and online, who is going, and the proof. Read from official conference pages, competitors' posts and your own; the Gulf comes first."
    >
      <PlatinaFormError message={error} />

      {s ? (
        <section aria-label="Next in the Gulf" className={cn(card, "border-primary/40 bg-primary/5")}>
          <p className={heading}>Next in the Gulf</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-medium">{s.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {s.dateText ?? s.startsOn} · {s.place ?? s.country}
              </p>
            </div>
            <p className="text-right">
              <span className="font-display text-4xl font-semibold text-primary">{s.daysLeft}</span>
              <span className="ml-1 text-sm text-muted-foreground">days to go</span>
            </p>
          </div>
          <Going e={s} />
          <p className="mt-3 text-xs">
            <Link href={`/p/${ws}/opportunities`} className="text-primary underline-offset-4 hover:underline">
              See it on Opportunities, with an AI campaign brief →
            </Link>
          </p>
        </section>
      ) : null}

      <section aria-label="Map" className="mt-6">
        <WorldMap countries={radar.countries} />
      </section>

      <section aria-label="In person" className="mt-8">
        <h2 className={heading}>In person · {radar.inPerson.length}</h2>
        {radar.inPerson.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No dated in-person event yet. Conference pages are read weekly.</p>
        ) : (
          <ul className="mt-3 grid gap-3 lg:grid-cols-2">
            {radar.inPerson.map((e) => (
              <EventRow key={e.id} e={e} ws={ws} clientId={client?.id ?? null} />
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Online" className="mt-8">
        <details className={card}>
          <summary className="cursor-pointer text-sm font-medium">Online sessions and webinars · {radar.online.length}</summary>
          <ul className="mt-3 space-y-2 text-sm">
            {radar.online.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {e.name} <span className="text-xs text-muted-foreground">· {when(e)}</span>
                  {e.going.length > 0 ? <span className="text-xs text-muted-foreground"> · {e.going.map((g) => g.name).join(", ")}</span> : null}
                </span>
                <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline-offset-4 hover:underline">
                  Source ↗
                </a>
              </li>
            ))}
          </ul>
        </details>
      </section>

      {radar.undated.length > 0 ? (
        <section aria-label="Dates not announced" className="mt-6">
          <details className={card}>
            <summary className="cursor-pointer text-sm font-medium">
              Known, dates not announced yet · {radar.undated.length}
            </summary>
            <ul className="mt-3 space-y-1 text-sm">
              {radar.undated.map((e) => (
                <li key={e.id}>
                  {e.gulf ? <span className="mr-1 text-primary">★</span> : null}
                  {e.name}
                  {e.country ? <span className="text-xs text-muted-foreground"> · {e.country}</span> : null}{" "}
                  <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline-offset-4 hover:underline">
                    Source ↗
                  </a>
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}
    </PlatinaPage>
  );
}
