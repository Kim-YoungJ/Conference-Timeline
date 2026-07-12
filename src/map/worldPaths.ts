// world-atlas TopoJSON → SVG path strings, hand-rolled equirectangular projection.
// Natural Earth geometry is pre-split at the antimeridian, so the linear mapping is safe.
import { feature } from 'topojson-client';
import worldData from 'world-atlas/countries-110m.json';

export const MAP_W = 1000;
export const MAP_H = 500;

export function project(lat: number, lng: number): [number, number] {
  return [((lng + 180) / 360) * MAP_W, ((90 - lat) / 180) * MAP_H];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const topo = worldData as any;
const geo = feature(topo, topo.objects.countries) as any;

// rings that cross the antimeridian (Fiji, Chukotka, Antarctica) would draw a
// horizontal line across the map — split into a new subpath on big lng jumps
function ringToPath(ring: [number, number][]): string {
  let d = '';
  let prevLng: number | null = null;
  let split = false;
  for (const [lng, lat] of ring) {
    const [x, y] = project(lat, lng);
    const jump = prevLng !== null && Math.abs(lng - prevLng) > 180;
    if (jump) split = true;
    d += `${prevLng === null || jump ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    prevLng = lng;
  }
  return d + (split ? '' : 'Z'); // fill auto-closes subpaths; omitting Z avoids the stroked seam
}

export const countryPaths: string[] = geo.features
  .filter((f: any) => f.geometry)
  .map((f: any) => {
    const polys: [number, number][][][] =
      f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    return polys.map((rings) => rings.map(ringToPath).join('')).join('');
  });
