'use server';

import { importCompanies } from './actions';

export async function importCompaniesAction(formData: FormData): Promise<void> {
  await importCompanies(formData);
}
