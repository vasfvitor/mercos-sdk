const BRAZIL = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * An instant in the form that `alterado_apos` takes. Mercos keeps `ultima_alteracao` in Brazilian
 * time: on 2026-09-20 the sandbox stamped 21:12 on a change made at 00:12 UTC.
 */
export function mercosTimestamp(instant: Date): string {
  const parts = BRAZIL.formatToParts(instant);
  const part = (type: string) => parts.find((each) => each.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}
