// Core feasibility + succession-planting engine.
// Given a plant's requirements, the site's climate, and what the user wants
// to harvest and when, this works out whether/when it can be grown and
// generates a planting schedule aimed at continuous yield.

export const MONTH_START_DOY = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
export const MONTH_END_DOY = [31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
export const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const SUN_RANK = { full_sun: 3, part_sun: 2, shade: 1 };

function getHeatMonths(climate, thresholdF = 85) {
  return climate.monthlyAvg.filter((m) => m.avgHighF != null && m.avgHighF >= thresholdF).map((m) => m.month);
}

/** Build one or more {start, end, season} DOY windows during which a plant can be planted. */
export function buildPlantingWindows(plant, climate) {
  const frostFreeStart = climate.hasFrost ? climate.avgLastSpringFrostDOY : 1;
  const frostFreeEnd = climate.hasFrost ? climate.avgFirstFallFrostDOY : 365;
  const heatMonths = getHeatMonths(climate);

  // Perennials (e.g. strawberry, blueberry) aren't gated by "must finish
  // maturing within one frost-free season" — they establish over multiple
  // years. Give them a normal planting window sized like any hardy crop,
  // without subtracting daysToMaturity.
  if (plant.perennial) {
    const start = Math.max(1, frostFreeStart - (plant.shoulderDays || 0));
    const end = climate.hasFrost ? climate.avgFirstFallFrostDOY - 30 : 335;
    return end >= start ? [{ start, end, season: "establishment" }] : [];
  }

  // Fall-planted, overwintering crops (e.g. garlic): planted shortly before
  // the first fall frost, mature the following year.
  if (plant.overwinters) {
    if (!climate.hasFrost) return [{ start: 274, end: 320, season: "fall (overwintering)" }];
    const start = Math.max(1, frostFreeEnd - 60);
    const end = frostFreeEnd - 14;
    return end >= start ? [{ start, end, season: "fall (overwintering)" }] : [];
  }

  if (plant.frostTolerance === "tender") {
    const start = frostFreeStart + 7;
    const end = frostFreeEnd - plant.daysToMaturity;
    return end >= start ? [{ start, end, season: "warm season" }] : [];
  }

  const shoulder = plant.shoulderDays || 0;

  if (plant.coolSeasonOnly) {
    const windows = [];
    const springStart = Math.max(1, frostFreeStart - shoulder);
    const firstHeatDOY = heatMonths.length ? MONTH_START_DOY[Math.min(...heatMonths)] : frostFreeEnd;
    const springEnd = firstHeatDOY - plant.daysToMaturity;
    if (springEnd >= springStart) windows.push({ start: springStart, end: springEnd, season: "spring" });

    if (climate.hasFrost) {
      const lastHeatDOY = heatMonths.length ? MONTH_END_DOY[Math.max(...heatMonths)] : springStart;
      const fallStart = heatMonths.length ? lastHeatDOY : springStart;
      const fallEnd = Math.min(365, frostFreeEnd + 14) - plant.daysToMaturity;
      if (fallEnd >= fallStart && fallStart > springEnd) windows.push({ start: fallStart, end: fallEnd, season: "fall" });
    }
    return windows;
  }

  const start = Math.max(1, frostFreeStart - shoulder);
  const end = (climate.hasFrost ? Math.min(365, frostFreeEnd + 14) : 365) - plant.daysToMaturity;
  return end >= start ? [{ start, end, season: "extended season" }] : [];
}

/** Generate concrete planting dates (as day-of-year) + resulting harvest ranges. */
export function generateSchedule(plant, windows, desiredStartDOY, desiredEndDOY) {
  const plantings = [];

  // Perennials fruit on a recurring annual calendar window once established,
  // not `daysToMaturity` after any single planting date.
  if (plant.perennial) {
    const startMonth = plant.typicalHarvestStartMonth || 6;
    const harvestStart = MONTH_START_DOY[startMonth - 1];
    const harvestEnd = harvestStart + plant.harvestWindowDays;
    for (const w of windows) {
      if (harvestEnd >= desiredStartDOY && harvestStart <= desiredEndDOY) {
        plantings.push({
          plantDOY: w.start, harvestStart, harvestEnd, season: w.season,
          note: `Perennial — first harvest ~${Math.round(plant.daysToMaturity / 365)} year(s) after planting, then annually around this window.`,
        });
      }
    }
    return plantings;
  }

  for (const w of windows) {
    if (plant.successionIntervalDays) {
      for (let plantDOY = w.start; plantDOY <= w.end; plantDOY += plant.successionIntervalDays) {
        const harvestStart = plantDOY + plant.daysToMaturity;
        const harvestEnd = harvestStart + plant.harvestWindowDays;
        if (harvestEnd >= desiredStartDOY && harvestStart <= desiredEndDOY) {
          plantings.push({ plantDOY, harvestStart, harvestEnd, season: w.season });
        }
      }
    } else {
      const idealPlantDOY = desiredStartDOY - plant.daysToMaturity;
      const plantDOY = idealPlantDOY > w.start && idealPlantDOY <= w.end ? idealPlantDOY : w.start;
      const harvestStart = plantDOY + plant.daysToMaturity;
      const harvestEnd = harvestStart + plant.harvestWindowDays;
      if (harvestEnd >= desiredStartDOY && harvestStart <= desiredEndDOY) {
        plantings.push({
          plantDOY, harvestStart, harvestEnd, season: w.season,
          note: plant.overwinters ? "Fall-planted; matures the following year." : undefined,
        });
      }
    }
  }
  return plantings.sort((a, b) => a.plantDOY - b.plantDOY);
}

function coverageFraction(plantings, desiredStartDOY, desiredEndDOY) {
  const total = desiredEndDOY - desiredStartDOY;
  if (total <= 0) return plantings.length ? 1 : 0;
  const intervals = plantings
    .map((p) => [Math.max(p.harvestStart, desiredStartDOY), Math.min(p.harvestEnd, desiredEndDOY)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0, curStart = null, curEnd = -Infinity;
  for (const [s, e] of intervals) {
    if (s > curEnd) {
      if (curStart != null) covered += curEnd - curStart;
      curStart = s; curEnd = e;
    } else {
      curEnd = Math.max(curEnd, e);
    }
  }
  if (curStart != null) covered += curEnd - curStart;
  return Math.min(1, covered / total);
}

function sunCompatible(bedSun, plantSun) {
  if (!bedSun) return true;
  return SUN_RANK[bedSun] >= SUN_RANK[plantSun];
}

/**
 * Evaluate whether/how a plant can meet the user's desired harvest window.
 * wish: { startMonth, endMonth } both 1-12, startMonth <= endMonth.
 * bed (optional): { sunExposure, soilPh }
 */
export function evaluatePlant(plant, wish, climate, bed) {
  // Overwintering crops (e.g. garlic) are planted one year and harvested the
  // next, so their harvest lands on an absolute day count past 365 — shift
  // the desired range onto that same timeline for comparison.
  const yearShift = plant.overwinters ? 365 : 0;
  const desiredStartDOY = MONTH_START_DOY[wish.startMonth - 1] + yearShift;
  const desiredEndDOY = MONTH_END_DOY[wish.endMonth - 1] + yearShift;

  const windows = buildPlantingWindows(plant, climate);
  const plantings = generateSchedule(plant, windows, desiredStartDOY, desiredEndDOY);
  const coverage = coverageFraction(plantings, desiredStartDOY, desiredEndDOY);

  const warnings = [];
  const seasonOk = windows.length > 0;
  if (!seasonOk) {
    warnings.push(`This climate's frost-free season doesn't fit ${plant.name}'s ${plant.daysToMaturity}-day maturity window.`);
  }

  if (bed) {
    if (bed.soilPh != null && (bed.soilPh < plant.phRange[0] - 0.3 || bed.soilPh > plant.phRange[1] + 0.3)) {
      warnings.push(`Soil pH ${bed.soilPh.toFixed(1)} is outside ${plant.name}'s preferred ${plant.phRange[0]}-${plant.phRange[1]} range. Amend soil or use a raised/container bed.`);
    }
    if (!sunCompatible(bed.sunExposure, plant.sun)) {
      warnings.push(`${plant.name} wants ${plant.sun.replace("_", " ")}, but "${bed.name}" is marked ${bed.sunExposure.replace("_", " ")}.`);
    }
  }

  let verdict;
  if (!seasonOk || coverage === 0) verdict = "not_feasible";
  else if (coverage >= 0.85 && warnings.length === 0) verdict = "feasible";
  else verdict = "partial";

  return { plant, wish, verdict, coverage, plantings, warnings, windows };
}

export function cellAreaSqFt(plant) {
  return (plant.spacingIn / 12) * (plant.rowSpacingIn / 12);
}

export function maxPlantsForArea(plant, areaSqFt) {
  const cell = cellAreaSqFt(plant);
  return cell > 0 ? Math.floor(areaSqFt / cell) : 0;
}

export function monthLabel(m) {
  return MONTH_NAMES[m - 1];
}
