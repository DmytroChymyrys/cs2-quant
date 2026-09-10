import artwork from "../../../../config/asset-images/catalog.json";
import { createHash } from "node:crypto";

export type Archetype =
  | "rifle"
  | "knife"
  | "gloves"
  | "case"
  | "momentum"
  | "reverting"
  | "volatile"
  | "quiet"
  | "contracting"
  | "expanding";
// Reference levels are invented demo inputs, never market-price estimates.
// Exact names and original, unmodified Steam URLs reuse the existing media map.
const selection: [keyof typeof artwork, Archetype, number, number][] = [
  ["AK-47 | Bloodsport (Field-Tested)", "momentum", 142, 320],
  ["AWP | Asiimov (Field-Tested)", "reverting", 112, 460],
  ["★ Butterfly Knife | Tiger Tooth (Factory New)", "knife", 1650, 38],
  ["★ Sport Gloves | Vice (Field-Tested)", "gloves", 890, 54],
  ["Dreams & Nightmares Case", "case", 1.85, 18400],
  ["M4A1-S | Decimator (Field-Tested)", "contracting", 24, 970],
  ["USP-S | Printstream (Field-Tested)", "rifle", 46, 630],
  ["AK-47 | Vulcan (Field-Tested)", "volatile", 235, 195],
  ["AK-47 | Redline (Field-Tested)", "rifle", 31, 1800],
  ["AK-47 | Inheritance (Field-Tested)", "momentum", 78, 730],
  ["M4A1-S | Black Lotus (Field-Tested)", "expanding", 12, 2400],
  ["M4A4 | Neo-Noir (Field-Tested)", "reverting", 18, 1250],
  ["Glock-18 | Candy Apple (Factory New)", "quiet", 1.6, 3800],
  ["Desert Eagle | Printstream (Field-Tested)", "rifle", 49, 690],
  ["AWP | Atheris (Field-Tested)", "expanding", 4.8, 3400],
  ["M4A1-S | Blue Phosphor (Factory New)", "quiet", 620, 48],
  ["★ Talon Knife | Tiger Tooth (Factory New)", "knife", 580, 84],
  ["★ Bowie Knife | Tiger Tooth (Factory New)", "knife", 245, 112],
  ["★ Kukri Knife | Fade (Factory New)", "knife", 460, 62],
  ["★ Nomad Knife | Slaughter (Minimal Wear)", "knife", 360, 51],
  ["★ Driver Gloves | Imperial Plaid (Field-Tested)", "gloves", 310, 92],
  ["★ Driver Gloves | Snow Leopard (Field-Tested)", "gloves", 490, 67],
  ["★ Specialist Gloves | Fade (Minimal Wear)", "gloves", 1240, 26],
  ["Recoil Case", "case", 0.65, 31000],
  ["Fracture Case", "case", 0.9, 27000],
  ["Operation Bravo Case", "quiet", 49, 610],
  ["Danger Zone Case", "contracting", 1.4, 19000],
  ["AWP | Dragon Lore (Factory New)", "quiet", 12500, 8],
  ["AK-47 | Wild Lotus (Factory New)", "quiet", 14800, 6],
  ["M4A1-S | Hot Rod (Factory New)", "volatile", 960, 37],
  ["P250 | Asiimov (Field-Tested)", "reverting", 5.5, 1700],
  ["★ Moto Gloves | Turtle (Field-Tested)", "gloves", 180, 145],
];
export const DEMO_UNIVERSE = selection.map(
  ([name, archetype, reference, depth]) => {
    // Separate namespace prevents a synthetic holding from sharing a real asset ID.
    const hash = createHash("sha256")
      .update(`floatalpha-demo-v1:${name}`)
      .digest("hex");
    return {
      id: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
      name,
      archetype,
      reference,
      depth,
      category: name.includes("Gloves")
        ? "GLOVES"
        : name.includes("Knife")
          ? "KNIFE"
          : name.endsWith("Case")
            ? "CASE"
            : "WEAPON_SKIN",
      artwork: {
        url: artwork[name],
        status: "UNVERIFIED" as const,
        width: null,
        height: null,
      },
    };
  },
);
export const DEMO_FOCUS = DEMO_UNIVERSE[0].id;
export const DEMO_HOLDINGS = [0, 1, 2, 3, 4, 5, 6, 8].map((index, i) => ({
  assetId: DEMO_UNIVERSE[index].id,
  quantity: [2, 1, 1, 1, 120, 3, 1, 4][i],
  unitCost: String(
    DEMO_UNIVERSE[index].reference *
      [0.93, 1.04, 0.96, 1.02, 0.88, 1.01, 0.98, 0.94][i],
  ),
}));
export const DEMO_WATCHLIST = [0, 2, 3, 5, 7, 10, 15, 26].map((i) => ({
  assetId: DEMO_UNIVERSE[i].id,
}));
