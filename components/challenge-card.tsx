"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Check, X, Share2, Lightbulb, Flame } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { Challenge } from "@/lib/challenges"

interface ChallengeCardProps {
  challenge: Challenge
  challengeNumber: number
  onAnswer: (correct: boolean) => void
  hasPlayed: boolean
  streak: number
}

export function ChallengeCard({
  challenge,
  challengeNumber,
  onAnswer,
  hasPlayed,
  streak,
}: ChallengeCardProps) {
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null)
  const [isRevealed, setIsRevealed] = useState(hasPlayed)
  const [wasCorrect, setWasCorrect] = useState<boolean | null>(null)

  const handleSelect = (index: number) => {
    if (isRevealed) return
    setSelectedAnswer(index)
  }

  const handleSubmit = () => {
    if (selectedAnswer === null) return
    const correct = selectedAnswer === challenge.correctAnswer
    setWasCorrect(correct)
    setIsRevealed(true)
    onAnswer(correct)
  }

  const handleShare = async () => {
    const result = wasCorrect ? "✅" : "❌"
    const text = `Faraday Daily Challenge #${challengeNumber}\n${result} ${wasCorrect ? "Solved!" : "Better luck tomorrow!"}\n🔥 Streak: ${streak}\n\nPlay at: ${window.location.href}`
    
    if (navigator.share) {
      try {
        await navigator.share({ text })
      } catch {
        await navigator.clipboard.writeText(text)
      }
    } else {
      await navigator.clipboard.writeText(text)
    }
  }

  const difficultyColor = {
    Easy: "bg-success/10 text-success border-success/20",
    Medium: "bg-warning/10 text-warning border-warning/20",
    Hard: "bg-destructive/10 text-destructive border-destructive/20",
  }

  return (
    <Card className="bg-card border-border overflow-hidden">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-secondary/50 text-muted-foreground border-border">
              #{challengeNumber}
            </Badge>
            <Badge variant="outline" className={cn("border", difficultyColor[challenge.difficulty])}>
              {challenge.difficulty}
            </Badge>
          </div>
          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
            {challenge.category}
          </Badge>
        </div>
        <h2 className="text-xl md:text-2xl font-semibold text-foreground leading-relaxed text-balance">
          {challenge.question}
        </h2>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-3">
          {challenge.options.map((option, index) => {
            const isSelected = selectedAnswer === index
            const isCorrect = index === challenge.correctAnswer
            const showCorrect = isRevealed && isCorrect
            const showIncorrect = isRevealed && isSelected && !isCorrect

            return (
              <motion.button
                key={index}
                onClick={() => handleSelect(index)}
                disabled={isRevealed}
                className={cn(
                  "w-full p-4 rounded-xl text-left transition-all duration-200 border",
                  "flex items-center justify-between gap-3",
                  !isRevealed && !isSelected && "bg-secondary/30 border-border hover:bg-secondary/50 hover:border-muted-foreground/30",
                  !isRevealed && isSelected && "bg-primary/10 border-primary/30 ring-2 ring-primary/20",
                  showCorrect && "bg-success/10 border-success/30",
                  showIncorrect && "bg-destructive/10 border-destructive/30",
                  isRevealed && !showCorrect && !showIncorrect && "bg-secondary/20 border-border opacity-50"
                )}
                whileTap={!isRevealed ? { scale: 0.98 } : {}}
              >
                <span className={cn(
                  "text-sm md:text-base",
                  showCorrect && "text-success font-medium",
                  showIncorrect && "text-destructive",
                  !showCorrect && !showIncorrect && "text-foreground"
                )}>
                  {option}
                </span>
                <AnimatePresence>
                  {showCorrect && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="flex-shrink-0"
                    >
                      <Check className="w-5 h-5 text-success" />
                    </motion.div>
                  )}
                  {showIncorrect && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="flex-shrink-0"
                    >
                      <X className="w-5 h-5 text-destructive" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.button>
            )
          })}
        </div>

        <AnimatePresence>
          {isRevealed && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              transition={{ duration: 0.3 }}
              className="pt-4"
            >
              <div className="p-4 rounded-xl bg-secondary/30 border border-border">
                <div className="flex items-start gap-3">
                  <Lightbulb className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground mb-1">Explanation</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {challenge.explanation}
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="pt-4 flex gap-3">
          {!isRevealed ? (
            <Button
              onClick={handleSubmit}
              disabled={selectedAnswer === null}
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              size="lg"
            >
              Submit Answer
            </Button>
          ) : (
            <>
              <div className={cn(
                "flex-1 p-4 rounded-xl flex items-center justify-center gap-2",
                wasCorrect ? "bg-success/10 border border-success/20" : "bg-destructive/10 border border-destructive/20"
              )}>
                {wasCorrect ? (
                  <>
                    <Check className="w-5 h-5 text-success" />
                    <span className="font-medium text-success">Correct!</span>
                    {streak > 0 && (
                      <span className="flex items-center gap-1 ml-2 text-primary">
                        <Flame className="w-4 h-4" />
                        {streak}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <X className="w-5 h-5 text-destructive" />
                    <span className="font-medium text-destructive">Incorrect</span>
                  </>
                )}
              </div>
              <Button
                onClick={handleShare}
                variant="outline"
                size="lg"
                className="border-border text-foreground hover:bg-secondary/50"
              >
                <Share2 className="w-4 h-4 mr-2" />
                Share
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
