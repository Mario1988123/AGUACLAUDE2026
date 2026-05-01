// Placeholder shared layout for modules whose UI hasn't been implemented yet.
// Each module gets its own folder with a page.tsx that uses ModulePlaceholder.
export default function PlaceholdersLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
