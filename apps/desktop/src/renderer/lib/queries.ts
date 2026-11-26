import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Api } from './api';
import { useSession } from './session';
import type { Account, Customer, InvoiceDetail, InvoiceSummary, Page, TaxCodeRow } from './types';

/** Inside the shell the API client always exists (the wizard handles unpaired state). */
export function useApi(): Api {
  const { api } = useSession();
  if (!api) throw new Error('Not paired with a server');
  return api;
}

export interface InvoiceFilters {
  status?: string;
  settlement?: string;
  q?: string;
  from?: string;
  to?: string;
  sort?: 'createdAt' | 'issueDate' | 'total' | 'number';
  dir?: 'asc' | 'desc';
}

export function useInvoices(filters: InvoiceFilters, cursor: string | undefined, limit = 50) {
  const api = useApi();
  return useQuery({
    queryKey: ['invoices', filters, cursor ?? null, limit],
    queryFn: () => api.get<Page<InvoiceSummary>>('/invoices', { query: { ...filters, cursor, limit } }),
  });
}

export function useInvoice(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['invoice', id],
    enabled: !!id,
    queryFn: () => api.get<InvoiceDetail>(`/invoices/${id}`),
  });
}

export function useCustomers() {
  const api = useApi();
  return useQuery({ queryKey: ['customers'], queryFn: () => api.get<Customer[]>('/customers', { query: { limit: 200 } }), staleTime: 60_000 });
}

export function useTaxCodes() {
  const api = useApi();
  return useQuery({ queryKey: ['tax-codes'], queryFn: () => api.get<TaxCodeRow[]>('/tax-codes'), staleTime: 300_000 });
}

export function useAccounts(enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: ['accounts'], enabled, queryFn: () => api.get<Account[]>('/accounts'), staleTime: 300_000 });
}

export function useInvalidateInvoices() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['invoices'] }).then(() => qc.invalidateQueries({ queryKey: ['invoice'] }));
}

export function useCreateCustomer() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<Customer>('/customers', { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  });
}
