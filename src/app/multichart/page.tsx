'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { MultiChartHeader } from '@/components/multichart/MultiChartHeader';

const MultiChartGrid = dynamic(
  () => import('@/components/multichart/MultiChartGrid').then((m) => m.MultiChartGrid),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm font-mono animate-pulse">
        Initializing Multi-Chart Grid…
      </div>
    ),
  },
);

function MultiChartContent() {
  const searchParams = useSearchParams();
  const isPopout = searchParams.get('popout') === 'true';

  return (
    <div
      className={
        isPopout
          ? 'fixed inset-0 z-50 flex flex-col h-screen w-screen overflow-hidden bg-[#070b14]'
          : 'flex flex-col h-full w-full overflow-hidden bg-[#070b14]'
      }
    >
      <MultiChartHeader isPopout={isPopout} />
      <MultiChartGrid />
    </div>
  );
}

export default function MultiChartPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm font-mono animate-pulse">
          Loading Multi-Chart…
        </div>
      }
    >
      <MultiChartContent />
    </Suspense>
  );
}
