'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Statement {
  id: number;
  text: string;
  answer: boolean;
  explanation: string;
}

const STATEMENTS: Statement[] = [
  {
    id: 1,
    text: "NVIDIA's H100 GPU uses TSMC's 4nm process",
    answer: true,
    explanation: "Correct. The H100 is built on TSMC's 4nm process technology.",
  },
  {
    id: 2,
    text: 'PUE stands for Power Utilization Efficiency',
    answer: false,
    explanation: 'Incorrect. PUE stands for Power Usage Effectiveness, a metric for data center energy efficiency.',
  },
  {
    id: 3,
    text: 'Equinix is the world\'s largest data center REIT',
    answer: true,
    explanation: 'Correct. Equinix is one of the leading global data center REITs.',
  },
  {
    id: 4,
    text: 'Liquid cooling eliminates the need for any air circulation in data centers',
    answer: false,
    explanation: 'Incorrect. Liquid cooling complements air circulation but doesn\'t eliminate the need for it entirely.',
  },
  {
    id: 5,
    text: 'FERC regulates interstate electricity transmission in the US',
    answer: true,
    explanation: 'Correct. The Federal Energy Regulatory Commission (FERC) oversees interstate electricity transmission.',
  },
  {
    id: 6,
    text: 'A typical hyperscale data center campus exceeds 100MW',
    answer: true,
    explanation: 'Correct. Hyperscale data center campuses typically operate at 100MW+ capacity.',
  },
  {
    id: 7,
    text: 'Busbar is a type of cooling technology',
    answer: false,
    explanation: 'Incorrect. A busbar is a power distribution conductor, not a cooling technology.',
  },
  {
    id: 8,
    text: 'Amazon Web Services operates data centers on every continent including Antarctica',
    answer: false,
    explanation: 'Incorrect. AWS does not operate data centers on Antarctica.',
  },
  {
    id: 9,
    text: 'ERCOT manages the electrical grid for most of Texas',
    answer: true,
    explanation: 'Correct. ERCOT (Electric Reliability Council of Texas) manages most of Texas\'s power grid.',
  },
  {
    id: 10,
    text: 'Direct liquid cooling can reduce cooling energy use by up to 40%',
    answer: true,
    explanation: 'Correct. Direct liquid cooling can achieve significant cooling energy reductions.',
  },
];

type GamePhase = 'playing' | 'results';

export default function CircuitPage() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(60);
  const [gamePhase, setGamePhase] = useState<GamePhase>('playing');
  const [answers, setAnswers] = useState<(boolean | null)[]>(Array(10).fill(null));
  const [score, setScore] = useState(0);
  const [speedBonus, setSpeedBonus] = useState(0);
  const [wrongAnswers, setWrongAnswers] = useState(0);
  const [flashColor, setFlashColor] = useState<'green' | 'red' | null>(null);
  const [penaltyTime, setPenaltyTime] = useState(0);

  // Timer countdown
  useEffect(() => {
    if (gamePhase !== 'playing' || timeRemaining <= 0) return;

    const timer = setInterval(() => {
      setTimeRemaining((prev) => {
        const newTime = prev - 1;
        if (newTime <= 0) {
          endGame();
          return 0;
        }
        return newTime;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [gamePhase, timeRemaining]);

  // Clear flash color after animation
  useEffect(() => {
    if (flashColor) {
      const timeout = setTimeout(() => setFlashColor(null), 500);
      return () => clearTimeout(timeout);
    }
  }, [flashColor]);

  // Handle penalty time
  useEffect(() => {
    if (penaltyTime > 0) {
      const timeout = setTimeout(() => {
        setTimeRemaining((prev) => Math.max(0, prev - 3));
        setPenaltyTime(0);
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [penaltyTime]);

  const handleAnswer = (answer: boolean) => {
    const correct = STATEMENTS[currentIndex].answer === answer;
    const newAnswers = [...answers];
    newAnswers[currentIndex] = answer;
    setAnswers(newAnswers);

    if (correct) {
      setFlashColor('green');
      // Speed bonus: +1 point per second remaining above 20s
      if (timeRemaining > 20) {
        const bonus = Math.min(timeRemaining - 20, 10);
        setSpeedBonus((prev) => prev + bonus);
      }
    } else {
      setFlashColor('red');
      setPenaltyTime(3);
      setWrongAnswers((prev) => prev + 1);
    }

    // Move to next statement or end game
    if (currentIndex < STATEMENTS.length - 1) {
      setTimeout(() => {
        setCurrentIndex((prev) => prev + 1);
      }, 500);
    } else {
      setTimeout(() => {
        endGame();
      }, 500);
    }
  };

  const endGame = () => {
    // Calculate final score
    const correctAnswers = answers.filter((ans, idx) => ans === STATEMENTS[idx].answer).length;
    let baseScore = 0;

    if (correctAnswers === 10) baseScore = 100;
    else if (correctAnswers === 9) baseScore = 85;
    else if (correctAnswers === 8) baseScore = 70;
    else if (correctAnswers === 7) baseScore = 55;
    else if (correctAnswers === 6) baseScore = 35;
    else baseScore = 10;

    const totalScore = baseScore + speedBonus;
    setScore(totalScore);
    setGamePhase('results');
  };

  const handleNewPuzzle = () => {
    setCurrentIndex(0);
    setTimeRemaining(60);
    setGamePhase('playing');
    setAnswers(Array(10).fill(null));
    setScore(0);
    setSpeedBonus(0);
    setWrongAnswers(0);
    setFlashColor(null);
    setPenaltyTime(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (gamePhase !== 'playing') return;
    if (e.key.toLowerCase() === 't') handleAnswer(true);
    if (e.key.toLowerCase() === 'f') handleAnswer(false);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-warm-white" onKeyDown={handleKeyDown} tabIndex={0}>
      {/* Back Link */}
      <div className="absolute top-6 left-6 z-10">
        <Link
          href="/"
          className="text-sm font-medium text-forest-mid hover:text-gold transition-colors"
        >
          ← Back to Challenge Lobby
        </Link>
      </div>

      {/* Main Container */}
      <div className="max-w-2xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-5xl mb-4">⚡</h1>
          <h2 className="text-3xl font-bold text-forest mb-2">Circuit</h2>
          <p className="text-warm-gray">True or False — 60 seconds</p>
        </div>

        {gamePhase === 'playing' && (
          <>
            {/* Timer */}
            <div className="text-center mb-8">
              <div
                className={`inline-block px-6 py-3 rounded-lg transition-all ${
                  flashColor
                    ? flashColor === 'green'
                      ? 'bg-green-500 text-white'
                      : 'bg-red-500 text-white'
                    : 'bg-forest-light'
                }`}
              >
                <span className="text-4xl font-bold font-mono">
                  {formatTime(timeRemaining)}
                </span>
              </div>
              {timeRemaining <= 10 && (
                <p className="text-red-600 font-semibold mt-2">Time running out!</p>
              )}
            </div>

            {/* Progress Dots */}
            <div className="flex justify-center gap-2 mb-8">
              {Array(10)
                .fill(null)
                .map((_, idx) => (
                  <div
                    key={idx}
                    className={`w-3 h-3 rounded-full transition-colors ${
                      answers[idx] !== null ? 'bg-gold' : 'bg-warm-gray'
                    }`}
                  />
                ))}
            </div>

            {/* Statement */}
            <div className="mb-12 p-8 bg-warm-cream rounded-lg border-2 border-forest-light">
              <p className="text-center text-2xl font-semibold text-forest leading-relaxed">
                {STATEMENTS[currentIndex].text}
              </p>
              <p className="text-center text-sm text-warm-gray mt-4 uppercase tracking-wide">
                Statement {currentIndex + 1} of 10
              </p>
            </div>

            {/* Answer Buttons */}
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => handleAnswer(true)}
                className="py-6 px-6 bg-forest text-white font-bold text-lg rounded-lg hover:bg-forest-mid transition-all transform hover:scale-105 uppercase tracking-wide"
              >
                True
              </button>
              <button
                onClick={() => handleAnswer(false)}
                className="py-6 px-6 bg-red-600 text-white font-bold text-lg rounded-lg hover:bg-red-700 transition-all transform hover:scale-105 uppercase tracking-wide"
              >
                False
              </button>
            </div>

            {/* Keyboard Hint */}
            <p className="text-center text-xs text-warm-gray mt-6 uppercase tracking-wide">
              Keyboard: Press <span className="font-bold">T</span> for True or{' '}
              <span className="font-bold">F</span> for False
            </p>
          </>
        )}

        {/* Results Screen */}
        {gamePhase === 'results' && (
          <div className="space-y-8">
            {/* Score Display */}
            <div className="text-center p-8 bg-warm-cream rounded-lg">
              <p className="text-sm text-warm-gray uppercase tracking-wide mb-2">Your Score</p>
              <div className="text-6xl font-bold text-gold mb-2">{score}</div>
              <p className="text-forest font-semibold">
                {score >= 90 && 'Outstanding! 🔥'}
                {score >= 70 && score < 90 && 'Great job! 👏'}
                {score >= 50 && score < 70 && 'Good attempt'}
                {score < 50 && 'Keep practicing'}
              </p>
              <p className="text-sm text-warm-gray mt-4">
                {Math.round(score / 10 * 10)}% correct
              </p>
            </div>

            {/* Score Breakdown */}
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="p-4 bg-green-50 rounded-lg border-2 border-green-500">
                <p className="text-sm text-warm-gray uppercase tracking-wide mb-1">Correct</p>
                <p className="text-3xl font-bold text-green-700">
                  {answers.filter((ans, idx) => ans === STATEMENTS[idx].answer).length}
                </p>
              </div>
              <div className="p-4 bg-red-50 rounded-lg border-2 border-red-500">
                <p className="text-sm text-warm-gray uppercase tracking-wide mb-1">Wrong</p>
                <p className="text-3xl font-bold text-red-700">{wrongAnswers}</p>
              </div>
              <div className="p-4 bg-gold bg-opacity-20 rounded-lg border-2 border-gold">
                <p className="text-sm text-warm-gray uppercase tracking-wide mb-1">Speed Bonus</p>
                <p className="text-3xl font-bold text-gold">+{speedBonus}</p>
              </div>
            </div>

            {/* Results List */}
            <div className="space-y-3">
              <h3 className="text-lg font-bold text-forest mb-4">Review Your Answers:</h3>
              {STATEMENTS.map((statement, idx) => {
                const userAnswer = answers[idx];
                const correct = userAnswer === statement.answer;
                return (
                  <div key={statement.id} className="space-y-2">
                    <div
                      className={`p-4 rounded-lg border-2 ${
                        correct
                          ? 'bg-green-50 border-green-500'
                          : 'bg-red-50 border-red-500'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-2xl mt-1">
                          {correct ? '✓' : '✗'}
                        </span>
                        <div className="flex-grow">
                          <p className="font-semibold text-near-black mb-2">
                            {statement.text}
                          </p>
                          <div className="text-sm space-y-1">
                            {userAnswer !== null && (
                              <p>
                                <span className="font-semibold">You answered:</span>{' '}
                                <span
                                  className={
                                    userAnswer === true
                                      ? 'text-forest font-bold'
                                      : 'text-red-600 font-bold'
                                  }
                                >
                                  {userAnswer ? 'True' : 'False'}
                                </span>
                              </p>
                            )}
                            <p>
                              <span className="font-semibold">Correct answer:</span>{' '}
                              <span
                                className={
                                  statement.answer === true
                                    ? 'text-forest font-bold'
                                    : 'text-red-600 font-bold'
                                }
                              >
                                {statement.answer ? 'True' : 'False'}
                              </span>
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* Explanation */}
                    <div className="px-4 py-3 bg-warm-cream rounded-lg text-sm italic text-forest">
                      {statement.explanation}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* New Puzzle Button */}
            <button
              onClick={handleNewPuzzle}
              className="w-full py-4 px-6 bg-gold text-white font-bold rounded-lg hover:bg-deep-amber transition-colors uppercase tracking-wide"
            >
              New Puzzle
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
