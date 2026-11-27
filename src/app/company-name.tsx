import { displayCompanyName, hasLiveCompanyName, type DisplayCompany, type LiveNames } from '@/lib/prospecting/live-names';

export function CompanyName({ company, names }: { company: DisplayCompany; names: LiveNames }) {
  return <>{displayCompanyName(company, names)}{hasLiveCompanyName(company, names) && <small className="ml-2 inline-block font-normal text-slate-500">Sin verificar · Google Maps</small>}</>;
}
