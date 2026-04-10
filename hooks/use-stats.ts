"use client"

import { useState, useEffect } from "react"

interface Stats {
  streak: number
  totalPlayed: number
  totalWins: number
  lastPlayedDate: string | null
}

const STORAGE_KEY = "faraday-challenge-stats"

function getDefaultStats(): Stats {
  return {
    streak: 0,
    totalPlayed: 0,
    totalWins: 0,
    lastPlayedDate: null,
  }
}

export function useStats() {
  const [stats, setStats] = useState<Stats>(getDefaultStats())
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setStats(parsed)
      } catch {
        setStats(getDefaultStats())
      }
    }
    setIsLoaded(true)
  }, [])

  const updateStats = (won: boolean) => {
    const today = new Date().toDateString()
    
    setStats((prev) => {
      // Check if already played today
      if (prev.lastPlayedDate === today) {
        return prev
      }

      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const wasYesterday = prev.lastPlayedDate === yesterday.toDateString()

      const newStats: Stats = {
        totalPlayed: prev.totalPlayed + 1,
        totalWins: won ? prev.totalWins + 1 : prev.totalWins,
        streak: won ? (wasYesterday || prev.streak === 0 ? prev.streak + 1 : 1) : 0,
        lastPlayedDate: today,
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(newStats))
      return newStats
    })
  }

  const hasPlayedToday = (): boolean => {
    const today = new Date().toDateString()
    return stats.lastPlayedDate === today
  }

  return { stats, updateStats, hasPlayedToday, isLoaded }
}
