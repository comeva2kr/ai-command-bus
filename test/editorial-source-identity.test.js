import test from "node:test";
import assert from "node:assert/strict";

import { operationalSourceIdentity } from "../src/feed/editorial-source-identity.js";

test("운영 출처 식별: 중계·섹션·표기 경로가 달라도 같은 발행사는 같은 키다", () => {
  const relayed = operationalSourceIdentity({ source: "gnews", sourceLabel: "매일경제" });
  const direct = operationalSourceIdentity({ source: "mk-stock", sourceLabel: "매경 증권", feedGroup: "mk" });
  assert.equal(relayed.ownershipGroup, "maekyung");
  assert.equal(direct.ownershipGroup, "maekyung");

  const ppomppuMain = operationalSourceIdentity({ source: "ppomppu", sourceLabel: "뽐뿌" });
  const ppomppuSection = operationalSourceIdentity({ source: "ppomppu-house", sourceLabel: "뽐뿌 부동산" });
  assert.equal(ppomppuMain.ownershipGroup, "ppomppu");
  assert.equal(ppomppuSection.ownershipGroup, "ppomppu");

  const hypebeastLabel = operationalSourceIdentity({ source: "hypebeast", sourceLabel: "하입비스트" });
  const hypebeastDeclared = operationalSourceIdentity({
    source: "hypebeast",
    sourceLabel: "하입비스트",
    ownershipGroup: "hypebeast"
  });
  assert.equal(hypebeastLabel.ownershipGroup, "hypebeast");
  assert.equal(hypebeastDeclared.ownershipGroup, "hypebeast");

  const bbcRelay = operationalSourceIdentity({ source: "gnews-world", sourceLabel: "BBC" });
  const bbcDirect = operationalSourceIdentity({ source: "bbc-world", sourceLabel: "BBC World" });
  assert.equal(bbcRelay.ownershipGroup, "bbc");
  assert.equal(bbcDirect.ownershipGroup, "bbc");
});

test("운영 출처 식별: 모르는 구글뉴스 발행사는 표시명별로 분리한다", () => {
  const a = operationalSourceIdentity({ source: "gnews", sourceLabel: "새매체 A" });
  const b = operationalSourceIdentity({ source: "gnews-kr", sourceLabel: "새매체 B" });
  assert.notEqual(a.ownershipGroup, b.ownershipGroup);
  assert.equal(a.ownershipBasis, "publisher_label_operational");
});

test("운영 출처 식별: 명시적 레지스트리 그룹이 최우선이다", () => {
  const identity = operationalSourceIdentity(
    { source: "source-a", sourceLabel: "표시명" },
    { registryEntry: { id: "source-a", ownershipGroup: "declared-family" } }
  );
  assert.equal(identity.ownershipGroup, "declared-family");
  assert.equal(identity.ownershipBasis, "registry_explicit");
});
