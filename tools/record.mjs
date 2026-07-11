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
  };
}
