import * as XLSX from 'xlsx';
import {
  computeEffectiveSeconds,
  formatDurationHMS,
  formatHoursDecimal,
  formatISTDate,
  formatISTTime,
} from '@/lib/timezone';
import type { TimeEntryWithRelations } from '@/types/database';

export interface ExportRow {
  Date: string;
  Employee: string;
  Email: string;
  Project: string;
  Task: string;
  Description: string;
  Type: string;
  Status: string;
  Start_IST: string;
  End_IST: string;
  Duration_HMS: string;
  Hours_Decimal: number;
}

export function buildExportRows(
  entries: TimeEntryWithRelations[],
  serverNowMs: number = Date.now(),
): ExportRow[] {
  return entries.map((entry) => {
    const secs = computeEffectiveSeconds(entry, serverNowMs);
    return {
      Date: formatISTDate(entry.work_date),
      Employee: entry.profile?.full_name || entry.profile?.email || 'Self',
      Email: entry.profile?.email || '',
      Project: entry.project?.name || 'Unknown Project',
      Task: entry.task?.title || '—',
      Description: entry.description || '',
      Type: entry.entry_type === 'manual' ? 'Manual' : 'Timer',
      Status: entry.status,
      Start_IST: formatISTTime(entry.started_at),
      End_IST: formatISTTime(entry.ended_at),
      Duration_HMS: formatDurationHMS(secs),
      Hours_Decimal: Number(formatHoursDecimal(secs)),
    };
  });
}

function escapeCsvCell(value: string | number): string {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportEntriesToCSV(
  entries: TimeEntryWithRelations[],
  filenamePrefix: string,
  serverNowMs: number = Date.now(),
): void {
  const rows = buildExportRows(entries, serverNowMs);
  const headers: (keyof ExportRow)[] = [
    'Date',
    'Employee',
    'Email',
    'Project',
    'Task',
    'Description',
    'Type',
    'Status',
    'Start_IST',
    'End_IST',
    'Duration_HMS',
    'Hours_Decimal',
  ];

  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escapeCsvCell(row[h])).join(',')),
  ];

  const csvContent = `\uFEFF${lines.join('\r\n')}`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `${filenamePrefix}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportEntriesToExcel(
  entries: TimeEntryWithRelations[],
  filenamePrefix: string,
  serverNowMs: number = Date.now(),
): void {
  const rows = buildExportRows(entries, serverNowMs);

  const byEmployeeMap = new Map<string, { Employee: string; Email: string; Entries: number; Seconds: number }>();
  const byProjectMap = new Map<string, { Project: string; Entries: number; Seconds: number }>();

  for (const entry of entries) {
    const secs = computeEffectiveSeconds(entry, serverNowMs);
    const empKey = entry.user_id;
    const empExisting = byEmployeeMap.get(empKey) ?? {
      Employee: entry.profile?.full_name || entry.profile?.email || 'Self',
      Email: entry.profile?.email || '',
      Entries: 0,
      Seconds: 0,
    };
    empExisting.Entries += 1;
    empExisting.Seconds += secs;
    byEmployeeMap.set(empKey, empExisting);

    const projKey = entry.project_id;
    const projExisting = byProjectMap.get(projKey) ?? {
      Project: entry.project?.name || 'Unknown Project',
      Entries: 0,
      Seconds: 0,
    };
    projExisting.Entries += 1;
    projExisting.Seconds += secs;
    byProjectMap.set(projKey, projExisting);
  }

  const employeeSummary = Array.from(byEmployeeMap.values()).map((item) => ({
    Employee: item.Employee,
    Email: item.Email,
    Entries: item.Entries,
    Duration_HMS: formatDurationHMS(item.Seconds),
    Hours_Decimal: Number(formatHoursDecimal(item.Seconds)),
  }));

  const projectSummary = Array.from(byProjectMap.values()).map((item) => ({
    Project: item.Project,
    Entries: item.Entries,
    Duration_HMS: formatDurationHMS(item.Seconds),
    Hours_Decimal: Number(formatHoursDecimal(item.Seconds)),
  }));

  const wb = XLSX.utils.book_new();
  const wsEntries = XLSX.utils.json_to_sheet(rows);
  const wsEmployees = XLSX.utils.json_to_sheet(employeeSummary);
  const wsProjects = XLSX.utils.json_to_sheet(projectSummary);

  XLSX.utils.book_append_sheet(wb, wsEntries, 'Time Entries');
  XLSX.utils.book_append_sheet(wb, wsEmployees, 'By Employee');
  XLSX.utils.book_append_sheet(wb, wsProjects, 'By Project');

  XLSX.writeFile(wb, `${filenamePrefix}.xlsx`);
}
