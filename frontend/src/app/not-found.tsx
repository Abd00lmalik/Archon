import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  return (
    <section className="mx-auto max-w-xl py-10">
      <div className="oris-card p-8 text-center">
        <div className="mx-auto w-fit">
          <Image src="/logo-icon.svg" alt="Oris logo icon" width={64} height={64} />
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-wide text-[#EAEAF0]">Page not found</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">The route you requested does not exist in Oris.</p>
        <Link href="/" className="oris-button-primary mt-6 inline-flex px-4 py-2 text-sm transition-all duration-200">
          Back to home
        </Link>
      </div>
    </section>
  );
}
