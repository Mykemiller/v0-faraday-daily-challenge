// ── Offline mock puzzles (NOT a registry) ───────────────────────────────────
//
// Fallback content used when the live bank is unreachable, so the lobby renders
// something playable rather than an error. It happens to cover the seven launch
// games; that is a property of the fixture, NOT a source of truth.
//
// ⚠️ The game ROSTER never comes from this object's keys — it comes from
// game_catalog (CC-DC-GAME-REGISTRY-1.0). A game with no mock entry is normal:
// the lobby shows its tile and the game screen reports no puzzle rather than
// crashing. Do not add a game here to make it appear.

export const MOCK_PUZZLES = {
  Rackl: {
    name: "The Power Stack",
    domain: "Power Architecture",
    groups: [
      { label:"800V DC Transition",   color:"#1C3424", textColor:"#F8F5F0", items:["Bus bar", "DC-DC converter", "Power shelf", "OCP ORW"] },
      { label:"Grid Access",          color:"#C4922A", textColor:"#141210", items:["Interconnect queue", "FERC Order", "Large-load study", "ISO/RTO"] },
      { label:"BTM Generation",       color:"#2A5A3A", textColor:"#F8F5F0", items:["SMR offtake", "Gas peaker", "Solar+storage", "BYOG contract"] },
      { label:"Cooling Architecture", color:"#5A4010", textColor:"#F8F5F0", items:["CDU", "Cold plate", "WUE", "Rear-door HX"] },
    ],
  },
  "Signal Drop": {
    name: "BUSBAR",
    domain: "Power Architecture",
    word: "BUSBAR",
    clue: "A rigid conductor distributing electrical power within a switchgear panel or power distribution unit",
    hint1: "Found in every data center switchroom",
    hint2: "Copper or aluminum, never flexible",
  },
  "The Stack": {
    name: "Rank GPU Generations: Hopper → Blackwell → Vera Rubin → Feynman",
    domain: "Chips & Density",
    items: ["H100 (Hopper)", "B200 (Blackwell)", "GB300 (Vera Rubin NVL72)", "Feynman (2028)"],
    correctOrder: [0, 1, 2, 3],
    metric: "TDP per chip (watts) — lowest to highest",
    values: ["700W", "1000W", "1200W", "~1500W est."],
  },
  Circuit: {
    name: "Power Architecture True/False Sprint #1",
    domain: "Power Architecture",
    timeLimit: 60,
    questions: [
      { q:"The 800V DC transition eliminates the need for per-rack UPS units.", a:true,  explanation:"800V DC-native racks eliminate per-rack AC/DC conversion and UPS stages, moving protection upstream." },
      { q:"NFPA 70 currently has complete code coverage for 800V DC data center distribution.", a:false, explanation:"NFPA 70 has significant gaps for 800V DC. The code framework is still catching up to the transition." },
      { q:"Behind-the-meter generation bypasses the ISO/RTO interconnection queue.", a:true,  explanation:"BTM generation connects directly to the facility, not to the grid — avoiding queue requirements entirely." },
      { q:"PJM's interconnection queue average wait time is currently under 2 years.", a:false, explanation:"PJM average queue wait exceeds 5 years as of 2026, driven by unprecedented large-load applications." },
      { q:"A CDU (Coolant Distribution Unit) is required for direct-to-chip liquid cooling.", a:true,  explanation:"The CDU is the central heat exchanger that manages facility-side coolant distribution to server-side cold plates." },
      { q:"WUE measures watts used per watt of IT load.", a:false, explanation:"WUE (Water Usage Effectiveness) measures liters of water per kWh of IT load — it's a water metric, not power." },
    ],
  },
  "The Brief": {
    name: "The 800V DC Transition",
    domain: "Power Architecture",
    readTime: 90,
    brief: `The AI data center industry is undergoing its most significant power architecture change in a generation: the shift from 415V AC to 800V DC distribution at the rack level.

Legacy data centers distribute power as alternating current (AC) at 415V (or 480V in the US), which requires multiple conversion stages — transformer to switchgear to UPS to PDU — before reaching the server. Each conversion wastes energy and adds failure points.

800V DC distribution eliminates three of those conversions. Power enters the facility as AC, converts once to 800V DC, and distributes directly to rack-level power shelves. GPU-native DC-DC converters inside the rack handle the final step. The result: higher efficiency, lower cooling burden on the power chain, and smaller copper footprint.

Eaton, Vertiv, and Schneider Electric are all acquiring capabilities in this space. OCP's Open Rack Wide (ORW) specification formalizes the 800V DC rack interface. NVIDIA's NVLink architecture is designed around DC-native power delivery.

The constraint: NFPA 70 (the National Electrical Code) does not yet have complete guidance for 800V DC in occupied buildings. Until the code catches up, facilities must navigate a patchwork of Authority Having Jurisdiction (AHJ) interpretations. Greenfield campuses are building to 800V DC today. Retrofits are operationally complex and expensive.`,
    questions: [
      {
        q: "What is the primary efficiency advantage of 800V DC distribution?",
        options: ["Higher voltage means less heat", "Fewer AC/DC conversion stages in the power chain", "Copper wire is cheaper at 800V", "UPS systems are not required"],
        correct: 1,
        explanation: "800V DC eliminates multiple conversion stages (transformer→switchgear→UPS→PDU→server), each of which wastes energy. Fewer conversions = higher round-trip efficiency."
      },
      {
        q: "What is the current primary constraint on 800V DC adoption in existing facilities?",
        options: ["Cost of copper busbars", "NFPA 70 code gap for 800V DC in occupied buildings", "GPU incompatibility", "Utility resistance to DC loads"],
        correct: 1,
        explanation: "NFPA 70 lacks complete code guidance for 800V DC. This forces facilities to work with local AHJ interpretations, creating inconsistency and risk across jurisdictions."
      },
      {
        q: "Which of the following companies is NOT mentioned as acquiring capabilities in 800V DC infrastructure?",
        options: ["Eaton", "Vertiv", "Schneider Electric", "Siemens"],
        correct: 3,
        explanation: "The brief mentions Eaton, Vertiv, and Schneider Electric. Siemens is a major player in this space but was not cited in this specific brief."
      },
    ],
  },
  "Dark Fiber": {
    name: "Power Architecture Terms #1",
    domain: "Power Architecture",
    pairs: [
      { term:"BUSBAR",      def:"A rigid conductor — copper or aluminum — that distributes electrical power within switchgear, bus ducts, or PDUs at high current with minimal loss"                },
      { term:"CDU",         def:"Coolant Distribution Unit — the rack-side heat exchanger that circulates chilled facility water to server-side cold plates in a direct liquid cooling loop"    },
      { term:"PUE",         def:"Power Usage Effectiveness — total facility power divided by IT load power; a score of 1.0 is perfect; real-world AI facilities target 1.2–1.4"                 },
      { term:"SWITCHGEAR",  def:"The assembly of circuit breakers, disconnects, and protective devices that controls and protects the electrical distribution system in a facility"             },
      { term:"WUE",         def:"Water Usage Effectiveness — liters of water consumed per kWh of IT load; the cooling equivalent of PUE; world-class target is below 0.5L/kWh"               },
      { term:"INTERCONNECT",def:"The physical and contractual connection between a generation asset or large load and the ISO/RTO transmission grid; acquiring a queue position takes years" },
    ],
  },
  Frequency: {
    name: "Power Architecture Quiz #1",
    domain: "Power Architecture",
    questions: [
      {
        q: "What does the acronym 'BYOG' stand for in data center power strategy?",
        options: ["Build Your Own Grid", "Bring Your Own Generation", "Bypass Your Operator Grid", "Backup Your Own Generator"],
        correct: 1,
        explanation: "BYOG (Bring Your Own Generation) refers to operators developing or contracting dedicated generation assets — nuclear, gas, solar — rather than relying solely on grid power."
      },
      {
        q: "Which ISO/RTO has the largest interconnection queue backlog in North America as of 2026?",
        options: ["ERCOT", "CAISO", "PJM", "MISO"],
        correct: 2,
        explanation: "PJM (covering the Mid-Atlantic and Midwest) has the largest backlog, with average queue wait times exceeding 5 years driven by AI data center demand in Northern Virginia and Ohio."
      },
      {
        q: "At what voltage does the emerging DC power distribution standard for high-density AI racks operate?",
        options: ["48V DC", "240V DC", "415V DC", "800V DC"],
        correct: 3,
        explanation: "800V DC is the emerging standard for high-density rack distribution, supported by OCP's Open Rack Wide (ORW) spec and NVIDIA's NVLink power architecture."
      },
      {
        q: "What does 'entitlement' mean in data center site selection?",
        options: ["Tax incentive approval", "Utility interconnection agreement", "Zoning and permitting approval for the intended use", "Grid capacity allocation"],
        correct: 2,
        explanation: "Entitlement refers to the regulatory and zoning approvals that permit the intended development. Entitled land with a grid queue position is categorically more valuable than unentitled land."
      },
    ],
  },
};
