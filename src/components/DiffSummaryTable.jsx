import { useMemo } from "react";

function getNodeValue(node, sel) {
  if (!sel) return `0/${node.maxRanks || 1}`;
  if (node.type === "choice") {
    return node.choices?.[sel.entryChosen]?.name ?? "Selected";
  }
  return `${sel.pointsInvested}/${node.maxRanks}`;
}

export default function DiffSummaryTable({ treeData, valid, setSpotlightId }) {
  const rows = useMemo(() => {
    if (!treeData?.nodes || !valid || valid.length < 2) return [];
    const results = [];
    if (valid.length === 2) {
      const [buildA, buildB] = valid;
      for (const node of treeData.nodes) {
        if (node.alreadyGranted) continue;
        const selA = buildA.parsed.nodes[node.id];
        const selB = buildB.parsed.nodes[node.id];
        const isDiff =
          (!selA && selB) ||
          (selA && !selB) ||
          (selA &&
            selB &&
            (node.type === "choice"
              ? selA.entryChosen !== selB.entryChosen
              : selA.pointsInvested !== selB.pointsInvested));
        if (isDiff) {
          results.push({
            node,
            valA: getNodeValue(node, selA),
            valB: getNodeValue(node, selB),
          });
        }
      }
    } else {
      for (const node of treeData.nodes) {
        if (node.alreadyGranted) continue;
        let count = 0;
        for (const { parsed } of valid) {
          if (parsed.nodes[node.id]) count++;
        }
        if (count > 0 && count < valid.length) {
          results.push({
            node,
            pickRate: `${count}/${valid.length} builds`,
          });
        }
      }
    }
    return results;
  }, [treeData, valid]);

  if (rows.length === 0) return null;

  const isDiffMode = valid.length === 2;

  return (
    <div className="mt-6 max-w-4xl mx-auto">
      <div className="wow-panel p-4 rounded shadow-lg border border-[#3a2e1a]">
        <h2 className="text-wow-gold text-sm uppercase tracking-widest mb-3 select-none flex items-center gap-2">
          <span>{isDiffMode ? "Diff Summary" : "Contested Talents"}</span>
          <span className="text-[11px] text-wow-muted lowercase tracking-normal">
            (hover to spotlight in tree)
          </span>
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#3a2e1a] text-wow-muted">
                <th className="py-2 px-3 font-semibold">Talent</th>
                {isDiffMode ? (
                  <>
                    <th className="py-2 px-3 font-semibold">
                      {valid[0].label}
                    </th>
                    <th className="py-2 px-3 font-semibold">
                      {valid[1].label}
                    </th>
                  </>
                ) : (
                  <th className="py-2 px-3 font-semibold">Pick Rate</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#3a2e1a]/50">
              {rows.map((row) => (
                <tr
                  key={row.node.id}
                  onMouseEnter={() => setSpotlightId?.(row.node.id)}
                  onMouseLeave={() => setSpotlightId?.(null)}
                  className="hover:bg-[#251b0d]/50 transition-colors cursor-default"
                >
                  <td className="py-2.5 px-3 font-medium text-wow-gold">
                    {row.node.name ||
                      (row.node.choices
                        ? row.node.choices.map((c) => c.name).join(" / ")
                        : "Unnamed Talent")}
                  </td>
                  {isDiffMode ? (
                    <>
                      <td className="py-2.5 px-3 text-wow-text">{row.valA}</td>
                      <td className="py-2.5 px-3 text-wow-text">{row.valB}</td>
                    </>
                  ) : (
                    <td className="py-2.5 px-3 text-wow-text font-mono">
                      {row.pickRate}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
