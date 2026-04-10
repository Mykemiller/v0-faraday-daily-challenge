"use client"

import { Flame, Trophy, Target } from "lucide-react"
import { motion } from "framer-motion"

interface StreakDisplayProps {
  streak: number
  totalWins: number
  totalPlayed: number
}

export function StreakDisplay({ streak, totalWins, totalPlayed }: StreakDisplayProps) {
  const winRate = totalPlayed > 0 ? Math.round((totalWins / totalPlayed) * 100) : 0

  return (
    <div className="grid grid-cols-3 gap-3">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="p-4 rounded-xl bg-card border border-border text-center"
      >
        <div className="flex items-center justify-center mb-2">
          <div className="p-2 rounded-lg bg-primary/10">
            <Flame className="w-5 h-5 text-primary" />
          </div>
        </div>
        <div className="text-2xl font-bold text-foreground">{streak}</div>
        <div className="text-xs text-muted-foreground">Streak</div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="p-4 rounded-xl bg-card border border-border text-center"
      >
        <div className="flex items-center justify-center mb-2">
          <div className="p-2 rounded-lg bg-success/10">
            <Trophy className="w-5 h-5 text-success" />
          </div>
        </div>
        <div className="text-2xl font-bold text-foreground">{totalWins}</div>
        <div className="text-xs text-muted-foreground">Wins</div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="p-4 rounded-xl bg-card border border-border text-center"
      >
        <div className="flex items-center justify-center mb-2">
          <div className="p-2 rounded-lg bg-chart-2/10">
            <Target className="w-5 h-5 text-chart-2" />
          </div>
        </div>
        <div className="text-2xl font-bold text-foreground">{winRate}%</div>
        <div className="text-xs text-muted-foreground">Accuracy</div>
      </motion.div>
    </div>
  )
}
