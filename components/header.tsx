"use client"

import { Zap, BarChart2, HelpCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

interface HeaderProps {
  stats: {
    streak: number
    totalPlayed: number
    totalWins: number
  }
}

export function Header({ stats }: HeaderProps) {
  const winRate = stats.totalPlayed > 0 
    ? Math.round((stats.totalWins / stats.totalPlayed) * 100) 
    : 0

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 border border-primary/20">
              <Zap className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-foreground">
                Faraday
              </h1>
              <p className="text-xs text-muted-foreground">Daily Challenge</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                  <HelpCircle className="w-5 h-5" />
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border">
                <DialogHeader>
                  <DialogTitle className="text-foreground">How to Play</DialogTitle>
                  <DialogDescription className="text-muted-foreground">
                    Test your science knowledge daily!
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 text-sm text-foreground/80">
                  <p>
                    Every day, a new physics or science question is presented. 
                    You have one chance to answer correctly.
                  </p>
                  <ul className="list-disc list-inside space-y-2">
                    <li>Read the question carefully</li>
                    <li>Select your answer from the options</li>
                    <li>Learn from the explanation</li>
                    <li>Build your streak by playing daily</li>
                  </ul>
                  <p className="text-muted-foreground">
                    Named after Michael Faraday, the pioneering physicist who 
                    discovered electromagnetic induction.
                  </p>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                  <BarChart2 className="w-5 h-5" />
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border">
                <DialogHeader>
                  <DialogTitle className="text-foreground">Your Statistics</DialogTitle>
                  <DialogDescription className="text-muted-foreground">
                    Track your progress over time
                  </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-3 gap-4 py-4">
                  <div className="text-center p-4 rounded-xl bg-secondary/50 border border-border">
                    <div className="text-3xl font-bold text-foreground">{stats.totalPlayed}</div>
                    <div className="text-xs text-muted-foreground mt-1">Played</div>
                  </div>
                  <div className="text-center p-4 rounded-xl bg-secondary/50 border border-border">
                    <div className="text-3xl font-bold text-foreground">{winRate}%</div>
                    <div className="text-xs text-muted-foreground mt-1">Win Rate</div>
                  </div>
                  <div className="text-center p-4 rounded-xl bg-primary/10 border border-primary/20">
                    <div className="text-3xl font-bold text-primary">{stats.streak}</div>
                    <div className="text-xs text-muted-foreground mt-1">Streak</div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>
    </header>
  )
}
