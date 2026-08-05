import { describe, expect, it } from 'vitest';
import {
  bucketIndexFor,
  histogram,
  histogramEdges,
  interpolate,
  mean,
  median,
  niceInterval,
  percentile,
  percentileSelection,
  summarise,
} from '@/domain/statistics';

describe('percentile', () => {
  // Expected values below are what Excel's PERCENTILE.INC returns for the same
  // input. The HR Manager will check these against their old spreadsheet.
  it('matches Excel PERCENTILE.INC on an even-length series', () => {
    const values = [1, 2, 3, 4];
    expect(percentile(values, 0.25)).toBe(1.75);
    expect(percentile(values, 0.5)).toBe(2.5);
    expect(percentile(values, 0.75)).toBe(3.25);
  });

  it('matches Excel PERCENTILE.INC on an odd-length series', () => {
    const values = [10, 20, 30, 40, 50];
    expect(percentile(values, 0.25)).toBe(20);
    expect(percentile(values, 0.5)).toBe(30);
    expect(percentile(values, 0.9)).toBe(46);
  });

  it('returns the extremes at p=0 and p=1', () => {
    const values = [5, 10, 15, 20];
    expect(percentile(values, 0)).toBe(5);
    expect(percentile(values, 1)).toBe(20);
  });

  it('returns the only value for a single-element series', () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0.9)).toBe(42);
  });

  it('has no answer for an empty series', () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it('rejects a percentile outside 0..1', () => {
    expect(() => percentile([1, 2, 3], 1.5)).toThrow(RangeError);
    expect(() => percentile([1, 2, 3], -0.1)).toThrow(RangeError);
  });
});

describe('percentileSelection', () => {
  // The analytics SQL uses these indices with ROW_NUMBER(), offset by one.
  // Sharing the arithmetic is what keeps SQL and JavaScript in agreement.
  it('brackets the percentile and says how far between the two it falls', () => {
    expect(percentileSelection(4, 0.25)).toEqual({ lowerIndex: 0, upperIndex: 1, fraction: 0.75 });
    expect(percentileSelection(5, 0.5)).toEqual({ lowerIndex: 2, upperIndex: 2, fraction: 0 });
  });

  it('agrees with the array implementation for every percentile of interest', () => {
    const values = [3, 9, 14, 22, 30, 41, 55, 67, 71, 90];
    for (const p of [0, 0.25, 0.5, 0.75, 0.9, 1]) {
      const selection = percentileSelection(values.length, p);
      expect(selection).not.toBeNull();

      const viaIndices = interpolate(
        values[selection!.lowerIndex]!,
        values[selection!.upperIndex]!,
        selection!.fraction,
      );
      expect(viaIndices).toBe(percentile(values, p));
    }
  });

  it('has no answer for an empty series', () => {
    expect(percentileSelection(0, 0.5)).toBeNull();
  });
});

describe('median and mean', () => {
  it('takes the midpoint of the two central values when the count is even', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('resists an outlier that drags the mean', () => {
    const salaries = [50, 55, 60, 65, 1_000];
    expect(median(salaries)).toBe(60);
    expect(mean(salaries)).toBe(246);
  });

  it('has no answer for an empty series', () => {
    expect(median([])).toBeNull();
    expect(mean([])).toBeNull();
  });
});

describe('summarise', () => {
  it('describes a distribution without requiring pre-sorted input', () => {
    const summary = summarise([30, 10, 50, 20, 40]);
    expect(summary).toEqual({
      count: 5,
      min: 10,
      max: 50,
      mean: 30,
      p25: 20,
      p50: 30,
      p75: 40,
      p90: 46,
    });
  });

  it('has no answer for an empty series', () => {
    expect(summarise([])).toBeNull();
  });
});

describe('niceInterval', () => {
  it('rounds up to a readable step', () => {
    expect(niceInterval(4_738)).toBe(5_000);
    expect(niceInterval(23)).toBe(25);
    expect(niceInterval(1)).toBe(1);
    expect(niceInterval(0.16)).toBe(0.2);
  });

  it('never returns zero, which would make an infinite number of buckets', () => {
    expect(niceInterval(0)).toBe(1);
    expect(niceInterval(-5)).toBe(1);
  });
});

describe('histogramEdges', () => {
  it('produces evenly spaced edges on round numbers', () => {
    expect(histogramEdges(0, 100, 10)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it('always spans the data, whatever the interval works out to', () => {
    const edges = histogramEdges(37_412, 214_889, 12);
    expect(edges.length).toBeGreaterThan(1);
    expect(edges[0]!).toBeLessThanOrEqual(37_412);
    expect(edges.at(-1)!).toBeGreaterThanOrEqual(214_889);

    const width = edges[1]! - edges[0]!;
    for (let i = 1; i < edges.length; i++) {
      expect(edges[i]! - edges[i - 1]!).toBeCloseTo(width, 6);
    }
  });

  it('gives a single distinct value one bucket rather than none', () => {
    expect(histogramEdges(5, 5)).toEqual([5, 6]);
  });

  it('returns nothing for an inverted range', () => {
    expect(histogramEdges(10, 5)).toEqual([]);
  });
});

describe('bucketIndexFor', () => {
  const edges = [0, 10, 20, 30];

  it('places a value in the bucket whose lower bound it meets', () => {
    expect(bucketIndexFor(0, edges)).toBe(0);
    expect(bucketIndexFor(9.99, edges)).toBe(0);
    expect(bucketIndexFor(10, edges)).toBe(1);
  });

  it('puts the maximum in the last bucket rather than one past the end', () => {
    expect(bucketIndexFor(30, edges)).toBe(2);
  });

  it('rejects values outside the range', () => {
    expect(bucketIndexFor(-1, edges)).toBeNull();
    expect(bucketIndexFor(31, edges)).toBeNull();
  });
});

describe('histogram', () => {
  it('counts every value exactly once', () => {
    const values = [1, 5, 12, 18, 23, 27, 29, 30];
    const buckets = histogram(values, 3);
    expect(buckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(values.length);
  });

  it('returns nothing for an empty series', () => {
    expect(histogram([])).toEqual([]);
  });
});
