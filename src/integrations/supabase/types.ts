export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      action_plan_items: {
        Row: {
          authored_at: string
          authored_by: string | null
          client_id: string
          headline: string
          id: string
          period: string
          position: number
          problem: string | null
          solution: string | null
        }
        Insert: {
          authored_at?: string
          authored_by?: string | null
          client_id: string
          headline: string
          id?: string
          period: string
          position?: number
          problem?: string | null
          solution?: string | null
        }
        Update: {
          authored_at?: string
          authored_by?: string | null
          client_id?: string
          headline?: string
          id?: string
          period?: string
          position?: number
          problem?: string | null
          solution?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "action_plan_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      canonical_roles: {
        Row: {
          code: string
          label: string
          sort_order: number | null
        }
        Insert: {
          code: string
          label: string
          sort_order?: number | null
        }
        Update: {
          code?: string
          label?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      department_rules: {
        Row: {
          active: boolean
          client_id: string
          confirmed_at: string
          confirmed_by: string | null
          effective_from: string | null
          franchise_label: string | null
          function_label: string | null
          id: string
          is_shared: boolean
          pattern: string
          superseded_by: string | null
        }
        Insert: {
          active?: boolean
          client_id: string
          confirmed_at?: string
          confirmed_by?: string | null
          effective_from?: string | null
          franchise_label?: string | null
          function_label?: string | null
          id?: string
          is_shared?: boolean
          pattern: string
          superseded_by?: string | null
        }
        Update: {
          active?: boolean
          client_id?: string
          confirmed_at?: string
          confirmed_by?: string | null
          effective_from?: string | null
          franchise_label?: string | null
          function_label?: string | null
          id?: string
          is_shared?: boolean
          pattern?: string
          superseded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "department_rules_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_rules_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "department_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_totals: {
        Row: {
          client_id: string
          comments: number | null
          entered_at: string
          entered_by: string | null
          id: string
          likes: number | null
          logins: number | null
          period: string
          recognitions: number | null
          source_note: string | null
        }
        Insert: {
          client_id: string
          comments?: number | null
          entered_at?: string
          entered_by?: string | null
          id?: string
          likes?: number | null
          logins?: number | null
          period: string
          recognitions?: number | null
          source_note?: string | null
        }
        Update: {
          client_id?: string
          comments?: number | null
          entered_at?: string
          entered_by?: string | null
          id?: string
          likes?: number | null
          logins?: number | null
          period?: string
          recognitions?: number | null
          source_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "engagement_totals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      exclusions: {
        Row: {
          active: boolean
          category: Database["public"]["Enums"]["exclusion_category"]
          client_id: string
          confirmed_at: string
          confirmed_by: string | null
          effective_from: string | null
          id: string
          match_type: Database["public"]["Enums"]["exclusion_match_type"]
          match_value: string
          reason: string | null
          superseded_by: string | null
        }
        Insert: {
          active?: boolean
          category: Database["public"]["Enums"]["exclusion_category"]
          client_id: string
          confirmed_at?: string
          confirmed_by?: string | null
          effective_from?: string | null
          id?: string
          match_type: Database["public"]["Enums"]["exclusion_match_type"]
          match_value: string
          reason?: string | null
          superseded_by?: string | null
        }
        Update: {
          active?: boolean
          category?: Database["public"]["Enums"]["exclusion_category"]
          client_id?: string
          confirmed_at?: string
          confirmed_by?: string | null
          effective_from?: string | null
          id?: string
          match_type?: Database["public"]["Enums"]["exclusion_match_type"]
          match_value?: string
          reason?: string | null
          superseded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exclusions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exclusions_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "exclusions"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_definitions: {
        Row: {
          description: string | null
          effective_from: string | null
          formula_note: string | null
          key: string
          version: number
        }
        Insert: {
          description?: string | null
          effective_from?: string | null
          formula_note?: string | null
          key: string
          version: number
        }
        Update: {
          description?: string | null
          effective_from?: string | null
          formula_note?: string | null
          key?: string
          version?: number
        }
        Relationships: []
      }
      period_readiness: {
        Row: {
          client_id: string
          id: string
          marked_ready_at: string
          marked_ready_by: string | null
          period: string
        }
        Insert: {
          client_id: string
          id?: string
          marked_ready_at?: string
          marked_ready_by?: string | null
          period: string
        }
        Update: {
          client_id?: string
          id?: string
          marked_ready_at?: string
          marked_ready_by?: string | null
          period?: string
        }
        Relationships: [
          {
            foreignKeyName: "period_readiness_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      person_period: {
        Row: {
          built_at: string
          checked_in: boolean | null
          checkin_count: number | null
          client_id: string
          department_raw: string | null
          departure_date_proxy: string | null
          employee_id_raw: string | null
          exclusion_reason: string | null
          flags: string[]
          franchise_label: string | null
          function_label: string | null
          hire_date: string | null
          id: string
          is_excluded: boolean
          last_login_at: string | null
          merged_from: string[]
          mood_avg: number | null
          name: string | null
          normalized_email: string
          period: string
          role_code: string | null
          status: string | null
          tenure_years: number | null
          title_raw: string | null
        }
        Insert: {
          built_at?: string
          checked_in?: boolean | null
          checkin_count?: number | null
          client_id: string
          department_raw?: string | null
          departure_date_proxy?: string | null
          employee_id_raw?: string | null
          exclusion_reason?: string | null
          flags?: string[]
          franchise_label?: string | null
          function_label?: string | null
          hire_date?: string | null
          id?: string
          is_excluded?: boolean
          last_login_at?: string | null
          merged_from?: string[]
          mood_avg?: number | null
          name?: string | null
          normalized_email: string
          period: string
          role_code?: string | null
          status?: string | null
          tenure_years?: number | null
          title_raw?: string | null
        }
        Update: {
          built_at?: string
          checked_in?: boolean | null
          checkin_count?: number | null
          client_id?: string
          department_raw?: string | null
          departure_date_proxy?: string | null
          employee_id_raw?: string | null
          exclusion_reason?: string | null
          flags?: string[]
          franchise_label?: string | null
          function_label?: string | null
          hire_date?: string | null
          id?: string
          is_excluded?: boolean
          last_login_at?: string | null
          merged_from?: string[]
          mood_avg?: number | null
          name?: string | null
          normalized_email?: string
          period?: string
          role_code?: string | null
          status?: string | null
          tenure_years?: number | null
          title_raw?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "person_period_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_period_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "canonical_roles"
            referencedColumns: ["code"]
          },
        ]
      }
      published_metrics: {
        Row: {
          client_id: string
          computed_at: string
          definition_version: number
          id: string
          metric_key: string
          period: string
          report_run_id: string | null
          scope: string
          value_numeric: number | null
          value_text: string | null
        }
        Insert: {
          client_id: string
          computed_at?: string
          definition_version: number
          id?: string
          metric_key: string
          period: string
          report_run_id?: string | null
          scope?: string
          value_numeric?: number | null
          value_text?: string | null
        }
        Update: {
          client_id?: string
          computed_at?: string
          definition_version?: number
          id?: string
          metric_key?: string
          period?: string
          report_run_id?: string | null
          scope?: string
          value_numeric?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "published_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "published_metrics_metric_key_definition_version_fkey"
            columns: ["metric_key", "definition_version"]
            isOneToOne: false
            referencedRelation: "metric_definitions"
            referencedColumns: ["key", "version"]
          },
          {
            foreignKeyName: "published_metrics_report_run_id_fkey"
            columns: ["report_run_id"]
            isOneToOne: false
            referencedRelation: "report_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_imports: {
        Row: {
          client_id: string
          column_names: string[] | null
          content_sha256: string
          covers_from: string | null
          covers_to: string | null
          exported_at: string | null
          id: string
          kind: Database["public"]["Enums"]["import_kind"]
          notes: string | null
          original_filename: string | null
          parse_error: string | null
          part_label: string | null
          period: string
          row_count: number | null
          state: Database["public"]["Enums"]["import_state"]
          storage_path: string | null
          superseded_by: string | null
          supersedes: string | null
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          client_id: string
          column_names?: string[] | null
          content_sha256: string
          covers_from?: string | null
          covers_to?: string | null
          exported_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["import_kind"]
          notes?: string | null
          original_filename?: string | null
          parse_error?: string | null
          part_label?: string | null
          period: string
          row_count?: number | null
          state?: Database["public"]["Enums"]["import_state"]
          storage_path?: string | null
          superseded_by?: string | null
          supersedes?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          client_id?: string
          column_names?: string[] | null
          content_sha256?: string
          covers_from?: string | null
          covers_to?: string | null
          exported_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["import_kind"]
          notes?: string | null
          original_filename?: string | null
          parse_error?: string | null
          part_label?: string | null
          period?: string
          row_count?: number | null
          state?: Database["public"]["Enums"]["import_state"]
          storage_path?: string | null
          superseded_by?: string | null
          supersedes?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_imports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_imports_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "raw_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_imports_supersedes_fkey"
            columns: ["supersedes"]
            isOneToOne: false
            referencedRelation: "raw_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_records: {
        Row: {
          client_id: string
          created_at_src: string | null
          created_raw: string | null
          department_raw: string | null
          email_raw: string | null
          employee_id_raw: string | null
          hire_date: string | null
          hire_date_raw: string | null
          id: string
          import_id: string
          inserted_at: string
          last_login_at: string | null
          last_login_raw: string | null
          modified_at_src: string | null
          modified_raw: string | null
          name_raw: string | null
          normalized_email: string | null
          parse_flags: string[]
          payload: Json
          period: string
          row_number: number | null
          status_raw: string | null
          title_raw: string | null
          user_type_raw: string | null
        }
        Insert: {
          client_id: string
          created_at_src?: string | null
          created_raw?: string | null
          department_raw?: string | null
          email_raw?: string | null
          employee_id_raw?: string | null
          hire_date?: string | null
          hire_date_raw?: string | null
          id?: string
          import_id: string
          inserted_at?: string
          last_login_at?: string | null
          last_login_raw?: string | null
          modified_at_src?: string | null
          modified_raw?: string | null
          name_raw?: string | null
          normalized_email?: string | null
          parse_flags?: string[]
          payload: Json
          period: string
          row_number?: number | null
          status_raw?: string | null
          title_raw?: string | null
          user_type_raw?: string | null
        }
        Update: {
          client_id?: string
          created_at_src?: string | null
          created_raw?: string | null
          department_raw?: string | null
          email_raw?: string | null
          employee_id_raw?: string | null
          hire_date?: string | null
          hire_date_raw?: string | null
          id?: string
          import_id?: string
          inserted_at?: string
          last_login_at?: string | null
          last_login_raw?: string | null
          modified_at_src?: string | null
          modified_raw?: string | null
          name_raw?: string | null
          normalized_email?: string | null
          parse_flags?: string[]
          payload?: Json
          period?: string
          row_number?: number | null
          status_raw?: string | null
          title_raw?: string | null
          user_type_raw?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_records_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_records_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "raw_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      recognition_counts: {
        Row: {
          client_id: string
          count: number
          department_raw: string
          entered_at: string
          entered_by: string | null
          id: string
          period: string
        }
        Insert: {
          client_id: string
          count: number
          department_raw: string
          entered_at?: string
          entered_by?: string | null
          id?: string
          period: string
        }
        Update: {
          client_id?: string
          count?: number
          department_raw?: string
          entered_at?: string
          entered_by?: string | null
          id?: string
          period?: string
        }
        Relationships: [
          {
            foreignKeyName: "recognition_counts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      record_merges: {
        Row: {
          active: boolean
          canonical_email: string
          client_id: string
          confirmed_at: string
          confirmed_by: string | null
          duplicate_email: string
          effective_from: string | null
          id: string
          reason: string | null
          superseded_by: string | null
        }
        Insert: {
          active?: boolean
          canonical_email: string
          client_id: string
          confirmed_at?: string
          confirmed_by?: string | null
          duplicate_email: string
          effective_from?: string | null
          id?: string
          reason?: string | null
          superseded_by?: string | null
        }
        Update: {
          active?: boolean
          canonical_email?: string
          client_id?: string
          confirmed_at?: string
          confirmed_by?: string | null
          duplicate_email?: string
          effective_from?: string | null
          id?: string
          reason?: string | null
          superseded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "record_merges_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "record_merges_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "record_merges"
            referencedColumns: ["id"]
          },
        ]
      }
      record_splits: {
        Row: {
          active: boolean
          client_id: string
          confirmed_at: string
          confirmed_by: string | null
          discriminator: string
          effective_from: string | null
          id: string
          normalized_email: string
          reason: string | null
          superseded_by: string | null
        }
        Insert: {
          active?: boolean
          client_id: string
          confirmed_at?: string
          confirmed_by?: string | null
          discriminator: string
          effective_from?: string | null
          id?: string
          normalized_email: string
          reason?: string | null
          superseded_by?: string | null
        }
        Update: {
          active?: boolean
          client_id?: string
          confirmed_at?: string
          confirmed_by?: string | null
          discriminator?: string
          effective_from?: string | null
          id?: string
          normalized_email?: string
          reason?: string | null
          superseded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "record_splits_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "record_splits_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "record_splits"
            referencedColumns: ["id"]
          },
        ]
      }
      report_format_sections: {
        Row: {
          client_id: string | null
          created_at: string
          format: Database["public"]["Enums"]["report_format"]
          id: string
          position: number
          section_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          format: Database["public"]["Enums"]["report_format"]
          id?: string
          position: number
          section_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          format?: Database["public"]["Enums"]["report_format"]
          id?: string
          position?: number
          section_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_format_sections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      report_run_metrics: {
        Row: {
          published_metric_id: string
          report_run_id: string
        }
        Insert: {
          published_metric_id: string
          report_run_id: string
        }
        Update: {
          published_metric_id?: string
          report_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_run_metrics_published_metric_id_fkey"
            columns: ["published_metric_id"]
            isOneToOne: false
            referencedRelation: "published_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_run_metrics_report_run_id_fkey"
            columns: ["report_run_id"]
            isOneToOne: false
            referencedRelation: "report_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      report_runs: {
        Row: {
          byte_size: number | null
          client_id: string
          created_at: string
          created_by: string | null
          format: Database["public"]["Enums"]["report_format"]
          id: string
          note: string | null
          page_count: number | null
          period: string
          storage_path: string | null
        }
        Insert: {
          byte_size?: number | null
          client_id: string
          created_at?: string
          created_by?: string | null
          format: Database["public"]["Enums"]["report_format"]
          id?: string
          note?: string | null
          page_count?: number | null
          period: string
          storage_path?: string | null
        }
        Update: {
          byte_size?: number | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          format?: Database["public"]["Enums"]["report_format"]
          id?: string
          note?: string | null
          page_count?: number | null
          period?: string
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      review_dismissals: {
        Row: {
          candidate_key: string
          client_id: string
          id: string
          kind: string
          note: string | null
          period_reviewed: string | null
          reviewed_at: string
          reviewed_by: string | null
        }
        Insert: {
          candidate_key: string
          client_id: string
          id?: string
          kind: string
          note?: string | null
          period_reviewed?: string | null
          reviewed_at?: string
          reviewed_by?: string | null
        }
        Update: {
          candidate_key?: string
          client_id?: string
          id?: string
          kind?: string
          note?: string | null
          period_reviewed?: string | null
          reviewed_at?: string
          reviewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_dismissals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      role_benchmarks: {
        Row: {
          id: string
          notes: string | null
          role_code: string
          source: string | null
          source_year: number | null
          turnover_pct: number | null
        }
        Insert: {
          id?: string
          notes?: string | null
          role_code: string
          source?: string | null
          source_year?: number | null
          turnover_pct?: number | null
        }
        Update: {
          id?: string
          notes?: string | null
          role_code?: string
          source?: string | null
          source_year?: number | null
          turnover_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "role_benchmarks_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "canonical_roles"
            referencedColumns: ["code"]
          },
        ]
      }
      role_mappings: {
        Row: {
          active: boolean
          client_id: string
          confirmed_at: string
          confirmed_by: string | null
          department_pattern: string | null
          effective_from: string | null
          id: string
          precedence: number
          reason: string | null
          role_code: string
          superseded_by: string | null
          title_pattern: string
        }
        Insert: {
          active?: boolean
          client_id: string
          confirmed_at?: string
          confirmed_by?: string | null
          department_pattern?: string | null
          effective_from?: string | null
          id?: string
          precedence?: number
          reason?: string | null
          role_code: string
          superseded_by?: string | null
          title_pattern: string
        }
        Update: {
          active?: boolean
          client_id?: string
          confirmed_at?: string
          confirmed_by?: string | null
          department_pattern?: string | null
          effective_from?: string | null
          id?: string
          precedence?: number
          reason?: string | null
          role_code?: string
          superseded_by?: string | null
          title_pattern?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_mappings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_mappings_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "canonical_roles"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "role_mappings_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "role_mappings"
            referencedColumns: ["id"]
          },
        ]
      }
      user_clients: {
        Row: {
          client_id: string
          granted_at: string
          id: string
          user_id: string
        }
        Insert: {
          client_id: string
          granted_at?: string
          id?: string
          user_id: string
        }
        Update: {
          client_id?: string
          granted_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_clients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          granted_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          granted_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          granted_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bootstrap_analyst: { Args: { _email: string }; Returns: string }
      can_write_client: {
        Args: { _client_id: string; _user_id: string }
        Returns: boolean
      }
      has_client_access: {
        Args: { _client_id: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_analyst: { Args: { _user_id: string }; Returns: boolean }
      is_known_user: { Args: { _user_id: string }; Returns: boolean }
      storage_path_client_id: { Args: { _name: string }; Returns: string }
    }
    Enums: {
      app_role: "analyst" | "coach" | "viewer"
      exclusion_category:
        | "test"
        | "demo"
        | "vendor"
        | "platform"
        | "internal"
        | "legacy"
        | "other"
      exclusion_match_type:
        | "email"
        | "name"
        | "employee_id"
        | "email_domain"
        | "keyword"
      import_kind:
        | "roster"
        | "mood_matrix"
        | "login_report"
        | "engagement_totals"
        | "recognition_counts"
        | "screenshot"
      import_state: "uploaded" | "parsed" | "failed" | "superseded"
      report_format: "portrait" | "landscape" | "wide" | "exec"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["analyst", "coach", "viewer"],
      exclusion_category: [
        "test",
        "demo",
        "vendor",
        "platform",
        "internal",
        "legacy",
        "other",
      ],
      exclusion_match_type: [
        "email",
        "name",
        "employee_id",
        "email_domain",
        "keyword",
      ],
      import_kind: [
        "roster",
        "mood_matrix",
        "login_report",
        "engagement_totals",
        "recognition_counts",
        "screenshot",
      ],
      import_state: ["uploaded", "parsed", "failed", "superseded"],
      report_format: ["portrait", "landscape", "wide", "exec"],
    },
  },
} as const
