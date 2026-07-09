// Place-data provider. Selects a real connector by which API key is configured.
// No data source configured => callers get NO_SOURCE and must show a setup
// state (never a fabricated result).

import { searchPlaces as kakaoSearch, kakaoConfigured } from "./connectors/kakao.js";

export function dataSourceStatus() {
  if (kakaoConfigured()) return { ready: true, source: "kakao" };
  return { ready: false, source: null };
}

export async function findPlaces(params) {
  if (!dataSourceStatus().ready) throw new Error("NO_SOURCE");
  return kakaoSearch(params);
}

export default { dataSourceStatus, findPlaces };
