export interface Challenge {
  id: number
  question: string
  options: string[]
  correctAnswer: number
  explanation: string
  category: string
  difficulty: "Easy" | "Medium" | "Hard"
}

export const challenges: Challenge[] = [
  {
    id: 1,
    question: "What fundamental force is responsible for electromagnetic induction, discovered by Michael Faraday?",
    options: [
      "Gravitational force",
      "Electromagnetic force",
      "Strong nuclear force",
      "Weak nuclear force"
    ],
    correctAnswer: 1,
    explanation: "Electromagnetic induction is caused by the electromagnetic force. Faraday discovered that a changing magnetic field induces an electric current in a conductor.",
    category: "Electromagnetism",
    difficulty: "Easy"
  },
  {
    id: 2,
    question: "In Faraday's law, what happens when the magnetic flux through a circuit increases?",
    options: [
      "No EMF is induced",
      "An EMF is induced opposing the change",
      "Current flows in the same direction as the field",
      "The circuit heats up instantly"
    ],
    correctAnswer: 1,
    explanation: "According to Lenz's law (part of Faraday's law), the induced EMF opposes the change in magnetic flux, maintaining energy conservation.",
    category: "Electromagnetism",
    difficulty: "Medium"
  },
  {
    id: 3,
    question: "What is the SI unit of magnetic flux, named after another scientist who worked with electromagnetic phenomena?",
    options: [
      "Tesla",
      "Farad",
      "Weber",
      "Henry"
    ],
    correctAnswer: 2,
    explanation: "The Weber (Wb) is the SI unit of magnetic flux, named after Wilhelm Eduard Weber. One Weber equals one volt-second.",
    category: "Units & Measurement",
    difficulty: "Easy"
  },
  {
    id: 4,
    question: "Which of these devices does NOT primarily rely on electromagnetic induction?",
    options: [
      "Electric generator",
      "Transformer",
      "Resistor",
      "Induction cooktop"
    ],
    correctAnswer: 2,
    explanation: "A resistor simply opposes current flow through resistance. Generators, transformers, and induction cooktops all use electromagnetic induction.",
    category: "Applications",
    difficulty: "Easy"
  },
  {
    id: 5,
    question: "What did Faraday use to demonstrate electromagnetic rotation in 1821?",
    options: [
      "A galvanometer",
      "A mercury bath with a magnet",
      "An iron ring",
      "A Leyden jar"
    ],
    correctAnswer: 1,
    explanation: "Faraday's electromagnetic rotation experiment used a wire dipping into mercury with a magnet, creating continuous circular motion - the first electric motor principle.",
    category: "History",
    difficulty: "Hard"
  },
  {
    id: 6,
    question: "The Faraday cage works because electric fields cause charges in the conductor to redistribute such that:",
    options: [
      "All charges leave the conductor",
      "The internal field is canceled out",
      "The external field is amplified",
      "Magnetic fields are generated"
    ],
    correctAnswer: 1,
    explanation: "In a Faraday cage, free charges redistribute to create an opposing field that cancels the external electric field inside the enclosure.",
    category: "Electrostatics",
    difficulty: "Medium"
  },
  {
    id: 7,
    question: "What is the mathematical relationship in Faraday's law between induced EMF and magnetic flux?",
    options: [
      "EMF equals flux",
      "EMF equals rate of change of flux",
      "EMF equals square of flux",
      "EMF equals integral of flux"
    ],
    correctAnswer: 1,
    explanation: "Faraday's law states that the induced EMF equals the negative rate of change of magnetic flux: ε = -dΦ/dt",
    category: "Mathematics",
    difficulty: "Medium"
  }
]

export function getTodaysChallenge(): Challenge {
  // Use date to determine which challenge (cycles through)
  const today = new Date()
  const dayOfYear = Math.floor(
    (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24)
  )
  const challengeIndex = dayOfYear % challenges.length
  return challenges[challengeIndex]
}

export function getChallengeNumber(): number {
  const startDate = new Date('2024-01-01')
  const today = new Date()
  const diffTime = Math.abs(today.getTime() - startDate.getTime())
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  return diffDays
}
