'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface StackItem {
  id: string;
  label: string;
  correctPosition: number;
}

const PUZZLE_DATA = {
  prompt: 'Rank these GPU generations from oldest to newest',
  items: [
    { id: '1', label: 'Hopper (H100)', correctPosition: 1 },
    { id: '2', label: 'Blackwell (B200)', correctPosition: 2 },
    { id: '3', label: 'Vera Rubin', correctPosition: 3 },
    { id: '4', label: 'Feynman', correctPosition: 4 },
  ],
};

type GameState = 'playing' | 'submitted' | 'timeExpired';

export default function TheStackPage() {
  const [items, setItems] = useState<StackItem[]>([]);
  const [gameState, setGameState] = useState<GameState>('playing');
  const [timeRemaining, setTimeRemaining] = useState(90);
  const [score, setScore] = useState<number | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [results, setResults] = useState<{ id: string; correct: boolean }[]>([]);

  // Initialize items shuffled
  useEffect(() => {
    const shuffled = [...PUZZLE_DATA.items].sort(() => Math.random() - 0.5);
    setItems(shuffled);
  }, []);

  // Timer countdown
  useEffect(() => {
    if (gameState !== 'playing' || timeRemaining <= 0) return;

    const timer = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          setGameState('timeExpired');
          // Auto-submit on time expire
          calculateScore(items);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [gameState, timeRemaining, items]);

  const calculateScore = (currentItems: StackItem[]) => {
    // Count how many items are in the correct position
    const correctCount = currentItems.filter(
      (item) => item.correctPosition === PUZZLE_DATA.items.findIndex((orig) => orig.id === item.id) + 1
    ).length;

    let calculatedScore = 0;
    const resultsList = currentItems.map((item) => {
      const isCorrect = item.correctPosition === PUZZLE_DATA.items.findIndex((orig) => orig.id === item.id) + 1;
      return { id: item.id, correct: isCorrect };
    });

    if (correctCount === 4) calculatedScore = 100;
    else if (correctCount === 3) calculatedScore = 75;
    else if (correctCount === 2) calculatedScore = 50;
    else if (correctCount === 1) calculatedScore = 20;
    else calculatedScore = 20;

    setResults(resultsList);
    setScore(calculatedScore);
  };

  const handleSwapItems = (index1: number, index2: number) => {
    const newItems = [...items];
    [newItems[index1], newItems[index2]] = [newItems[index2], newItems[index1]];
    setItems(newItems);
    setSelectedItem(null);
  };

  const handleMoveUp = (index: number) => {
    if (index > 0) {
      handleSwapItems(index, index - 1);
    }
  };

  const handleMoveDown = (index: number) => {
    if (index < items.length - 1) {
      handleSwapItems(index, index + 1);
    }
  };

  const handleItemClick = (id: string) => {
    if (selectedItem === null) {
      setSelectedItem(id);
    } else if (selectedItem === id) {
      setSelectedItem(null);
    } else {
      const index1 = items.findIndex((item) => item.id === selectedItem);
      const index2 = items.findIndex((item) => item.id === id);
      handleSwapItems(index1, index2);
    }
  };

  const handleSubmit = () => {
    calculateScore(items);
    setGameState('submitted');
  };

  const handleNewPuzzle = () => {
    const shuffled = [...PUZZLE_DATA.items].sort(() => Math.random() - 0.5);
    setItems(shuffled);
    setGameState('playing');
    setTimeRemaining(90);
    setScore(null);
    setSelectedItem(null);
    setResults([]);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-warm-white">
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
        <div className="text-center mb-12">
          <h1 className="text-5xl mb-4">📊</h1>
          <h2 className="text-3xl font-bold text-forest mb-2">The Stack</h2>
          <p className="text-warm-gray">Rank items in the correct order</p>
        </div>

        {gameState === 'playing' && (
          <>
            {/* Timer */}
            <div className="text-center mb-8">
              <div className="inline-block px-6 py-3 rounded-lg bg-forest-light">
                <span className="text-3xl font-bold text-gold font-mono">
                  {formatTime(timeRemaining)}
                </span>
              </div>
              {timeRemaining <= 10 && (
                <p className="text-red-600 font-semibold mt-2">Time running out!</p>
              )}
            </div>

            {/* Puzzle Prompt */}
            <div className="mb-8 p-6 bg-warm-cream rounded-lg border-2 border-forest-light">
              <p className="text-center text-lg font-semibold text-forest">
                {PUZZLE_DATA.prompt}
              </p>
            </div>

            {/* Draggable Items */}
            <div className="space-y-3 mb-8">
              {items.map((item, index) => (
                <div key={item.id} className="flex items-center gap-4">
                  {/* Position Number */}
                  <div className="w-12 h-12 flex items-center justify-center rounded-lg bg-gold text-near-black font-bold text-lg">
                    {index + 1}
                  </div>

                  {/* Item Card */}
                  <div
                    onClick={() => handleItemClick(item.id)}
                    className={`flex-grow p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      selectedItem === item.id
                        ? 'border-gold bg-gold bg-opacity-10 shadow-lg'
                        : 'border-forest-light bg-white hover:border-gold'
                    }`}
                  >
                    <p className="font-semibold text-near-black">{item.label}</p>
                  </div>

                  {/* Up/Down Buttons */}
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0}
                      className="p-2 rounded hover:bg-gold hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => handleMoveDown(index)}
                      disabled={index === items.length - 1}
                      className="p-2 rounded hover:bg-gold hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="Move down"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Submit Button */}
            <button
              onClick={handleSubmit}
              disabled={gameState !== 'playing'}
              className="w-full py-4 px-6 bg-gold text-white font-bold rounded-lg hover:bg-deep-amber disabled:opacity-50 disabled:cursor-not-allowed transition-colors uppercase tracking-wide"
            >
              Submit Order
            </button>
          </>
        )}

        {/* Results Screen */}
        {(gameState === 'submitted' || gameState === 'timeExpired') && (
          <div className="space-y-8">
            {/* Score Display */}
            <div className="text-center p-8 bg-warm-cream rounded-lg">
              <p className="text-sm text-warm-gray uppercase tracking-wide mb-2">Your Score</p>
              <div className="text-6xl font-bold text-gold mb-2">{score}</div>
              <p className="text-forest font-semibold">
                {score === 100 && 'Perfect! 🎯'}
                {score === 75 && 'Excellent!'}
                {score === 50 && 'Good effort'}
                {score === 20 && 'Try again'}
                {score === 0 && 'Time expired'}
              </p>
            </div>

            {/* Results List */}
            <div className="space-y-3">
              <h3 className="text-lg font-bold text-forest mb-4">Your Order:</h3>
              {items.map((item, index) => {
                const result = results.find((r) => r.id === item.id);
                const isCorrect = result?.correct;
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-4 p-4 rounded-lg border-2 ${
                      isCorrect
                        ? 'bg-green-50 border-green-500'
                        : 'bg-red-50 border-red-500'
                    }`}
                  >
                    <div className="w-12 h-12 flex items-center justify-center rounded-lg font-bold text-lg bg-warm-gray text-white">
                      {index + 1}
                    </div>
                    <div className="flex-grow">
                      <p className={`font-semibold ${isCorrect ? 'text-green-700' : 'text-red-700'}`}>
                        {item.label}
                      </p>
                    </div>
                    <div className="text-2xl">
                      {isCorrect ? '✓' : '✗'}
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
