export function buildSetRecord(raw, ctx) {
  return {
    set_num: raw.set_num,
    num: raw.set_num.replace(/-\d+$/, ''),
    name: raw.name,
    year: Number(raw.year),
    theme_id: Number(raw.theme_id),
    theme: ctx.themeName,
    root: ctx.root,
    category: ctx.category,
    pieces: Number(raw.num_parts),
    img: ctx.img,
    footprint: ctx.footprint,
    // Round-1 feedback 2a/2b: no longer sold new by LEGO (drives the catalog's Retired badge and
    // the Legacy toggle). Always present so the runtime never guesses.
    retired: !!ctx.retired,
  };
}
