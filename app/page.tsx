"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Header } from "@/components/header"
import { ChallengeCard } from "@/components/challenge-card"
import { StreakDisplay } from "@/components/streak-display"
import { CountdownTimer } from "@/components/countdown-timer"
import { useStats } from "@/hooks/use-stats"
import { getTodaysChallenge, getChallengeNumber } from "@/lib/challenges"
import { Zap } from "lucide-react"

export default function Home() {
  const { stats, updateStats, hasPlayedToday, isLoaded } = useStats()
  const [challenge, setChallenge] = useState(getTodaysChallenge())
  const [challengeNumber, setChallengeNumber] = useState(getChallengeNumber())

  useEffect(() => {
    setChallenge(getTodaysChallenge())
    setChallengeNumber(getChallengeNumber())
  }, [])

  const handleAnswer = (correct: boolean) => {
    updateStats(correct)
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <Zap className="w-8 h-8 text-primary" />
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Header stats={stats} />

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-6"
        >
          {/* Hero Section */}
          <div className="text-center space-y-2 mb-8">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium"
            >
              <Zap className="w-4 h-4" />
              Challenge #{challengeNumber}
            </motion.div>
            <h2 className="text-2xl md:text-3xl font-bold text-foreground text-balance">
              Test Your Science Knowledge
            </h2>
            <p className="text-muted-foreground text-sm md:text-base">
              A new physics challenge every day
            </p>
          </div>

          {/* Stats Bar */}
          <StreakDisplay
            streak={stats.streak}
            totalWins={stats.totalWins}
            totalPlayed={stats.totalPlayed}
          />

          {/* Challenge Card */}
          <ChallengeCard
            challenge={challenge}
            challengeNumber={challengeNumber}
            onAnswer={handleAnswer}
            hasPlayed={hasPlayedToday()}
            streak={stats.streak}
          />

          {/* Countdown Timer */}
          <CountdownTimer />

          {/* Footer */}
          <div className="text-center py-4">
            <p className="text-xs text-muted-foreground">
              Inspired by Michael Faraday (1791-1867)
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Pioneer of electromagnetism
            </p>
          </div>
        </motion.div>
      </main>
    </div>
  )
}
