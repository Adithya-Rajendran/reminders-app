import {
  W_TIERS, H_TIERS, W_BREAKS, H_BREAKS,
  widthTier, heightTier, sizeName, classifySize,
  atLeastW, atMostW, atLeastH, atMostH, DEFAULT_WIDGET_SIZE,
} from '../client/src/widgetsize.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// --- tier boundaries: each break is the LOWER bound of its tier ---
for (const [t, b] of Object.entries(W_BREAKS)) ok(widthTier(b) === t, `width break ${b} -> ${t}`)
for (const [t, b] of Object.entries(H_BREAKS)) ok(heightTier(b) === t, `height break ${b} -> ${t}`)
ok(widthTier(0) === 'xs' && widthTier(259) === 'xs', 'xs width below 260')
ok(widthTier(360) === 'md' && widthTier(539) === 'md', 'md is the compact band')
ok(widthTier(840) === 'xl' && widthTier(99999) === 'xl', 'xl saturates at the top')
ok(heightTier(0) === 'xs' && heightTier(519) === 'md' && heightTier(520) === 'lg', 'height tiers')

// --- defensive against junk input (NaN/undefined -> smallest tier) ---
ok(widthTier(undefined) === 'xs' && widthTier(NaN) === 'xs', 'bad width -> xs, no throw')
ok(heightTier(-50) === 'xs', 'negative height -> xs')

// --- historical thresholds the migrated Calendar/Notes rely on ---
ok(widthTier(359) !== widthTier(360), 'Calendar mini/compact edge at 360')
ok(widthTier(539) !== widthTier(540), 'Calendar compact/full edge at 540')

// --- classifySize: complete, frozen descriptor ---
const s = classifySize({ width: 412, height: 530 })
ok(s.w === 'md' && s.h === 'lg', 'classify maps both dims independently')
ok(typeof s.name === 'string' && s.width === 412 && s.height === 530, 'classify keeps name + raw px')
ok(Object.isFrozen(s), 'descriptor is frozen (safe to share through context)')
ok(classifySize().w === 'xs' && classifySize({}).h === 'xs', 'classify with no/empty dims -> xs')

// --- friendly name collapses the 2D grid sensibly ---
ok(sizeName('xs', 'xs') === 'mini', 'narrow + short -> mini')
ok(sizeName('xs', 'lg') === 'tall', 'narrow + tall -> tall')
ok(sizeName('xl', 'xs') === 'wide', 'wide + short -> wide')
ok(sizeName('xl', 'lg') === 'large', 'roomy both ways -> large')
ok(sizeName('md', 'md') === 'standard', 'the default neighborhood -> standard')

// --- comparators read as intent ---
ok(atLeastW({ w: 'lg' }, 'md') && atLeastW({ w: 'md' }, 'md'), 'atLeastW inclusive + ordered')
ok(!atLeastW({ w: 'sm' }, 'lg'), 'atLeastW: sm is not >= lg')
ok(atMostW({ w: 'sm' }, 'md') && !atMostW({ w: 'xl' }, 'md'), 'atMostW ordered')
ok(atLeastH({ h: 'lg' }, 'sm') && !atLeastH({ h: 'xs' }, 'md'), 'atLeastH ordered')
ok(atMostH({ h: 'sm' }, 'md') && !atMostH({ h: 'lg' }, 'sm'), 'atMostH ordered')

// --- the seed default is a real mid tier, frozen ---
ok(DEFAULT_WIDGET_SIZE.w === 'md' && DEFAULT_WIDGET_SIZE.h === 'md', 'default is a mid tier (no flash)')
ok(Object.isFrozen(DEFAULT_WIDGET_SIZE), 'default is frozen')
ok(W_TIERS.length === 5 && H_TIERS.length === 4, 'tier lists intact')

console.log(`widgetsize: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
