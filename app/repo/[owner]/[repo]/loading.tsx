const S = ({ h }: { h: string }) => <div className={`animate-pulse rounded-lg border border-line bg-card ${h}`} />;
export default function Loading() {
  return (
    <main className="mx-auto max-w-[1280px] space-y-4 px-4 py-8 sm:px-6" aria-busy="true">
      <S h="h-16" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <S key={i} h="h-24" />)}</div>
      <S h="h-80" />
      <div className="grid gap-4 lg:grid-cols-2"><S h="h-64" /><S h="h-64" /></div>
    </main>
  );
}
