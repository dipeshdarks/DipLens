import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">Repository not found</h1>
      <p className="mt-2 text-sm text-mute">Check the owner and name, and make sure the repository is public.</p>
      <Link href="/" className="btn mt-6">Search again</Link>
    </main>
  );
}
