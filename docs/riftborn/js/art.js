/*
 * RIFTBORN — which picture a species gets.
 *
 * Two renderers exist at once, on purpose. creature.js has drawings, one per
 * species, made by hand; voxel.js builds a model from the data for anything not
 * drawn yet. Forty-three species do not get drawn in one sitting, and the
 * alternative to this seam is a game that is missing monsters until they all
 * are.
 *
 * Everything that puts a monster on screen goes through here, so when a species
 * is drawn it appears everywhere at once — map, Codex, Sanctuary, battle, field
 * report — rather than in whichever surfaces somebody remembered.
 */

import { spriteFor as voxelSprite, modelFor, fitModel } from './voxel.js';
import { spriteFor as drawnSprite, drawCreature, hasArt, drawnCount } from './creature.js';

export { hasArt, drawnCount };

/**
 * A sprite for this species at this size.
 *
 * `rot` is the voxel models' turn angle. A drawing has no turn — it is one
 * view — so it ignores it, which is the one visible difference between the two
 * and the reason the Codex stops spinning a species once it is drawn.
 */
export function spriteFor(species, px, rot = 0.125, opts = {}) {
  return hasArt(species.id) ? drawnSprite(species, px, opts) : voxelSprite(species, px, rot, opts);
}

/**
 * Paint a species to fill a canvas — the Codex portrait, the Sanctuary card, the
 * two sides of a battle.
 *
 * Takes the model painter's options so the two are interchangeable at every call
 * site. A drawing ignores `turns`, because a drawing is one view; `facing: -1`
 * mirrors it, which is how your own monster reads as facing away without a
 * label, and is the drawn equivalent of turning the model half around.
 */
export function paintInto(ctx, species, {
  turns = 0.125, width, height, pad = 0.88, alpha = 1, flash = 0,
  riftTouched = false, biome = null, facing = 1,
} = {}) {
  if (!hasArt(species.id)) {
    return fitModel(ctx, modelFor(species, { riftTouched, biome }),
                    { turns: facing < 0 ? turns + 0.5 : turns, width, height, pad, alpha, flash });
  }
  const box = Math.min(width, height) * pad;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(width / 2, height / 2);
  ctx.scale((facing < 0 ? -1 : 1) * (box / 100), box / 100);
  ctx.translate(-50, -50);
  drawCreature(ctx, species, { riftTouched, biome });
  ctx.restore();

  if (flash > 0) {
    // The hit flash, clipped to what was just drawn rather than to the box, so a
    // struck monster lights up instead of sitting in a white square.
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = Math.min(1, flash);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
  return undefined;
}
