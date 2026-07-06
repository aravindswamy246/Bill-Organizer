export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      bills: {
        Row: {
          bill_date: string | null;
          category: Database['public']['Enums']['bill_category'];
          created_at: string;
          currency: string;
          extracted_json: Json | null;
          id: string;
          is_insurance_document: boolean;
          is_warranty_document: boolean;
          merchant_name: string | null;
          source: Database['public']['Enums']['bill_source'];
          status: Database['public']['Enums']['bill_status'];
          storage_path: string | null;
          total_amount: number | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          bill_date?: string | null;
          category?: Database['public']['Enums']['bill_category'];
          created_at?: string;
          currency?: string;
          extracted_json?: Json | null;
          id?: string;
          is_insurance_document?: boolean;
          is_warranty_document?: boolean;
          merchant_name?: string | null;
          source: Database['public']['Enums']['bill_source'];
          status?: Database['public']['Enums']['bill_status'];
          storage_path?: string | null;
          total_amount?: number | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          bill_date?: string | null;
          category?: Database['public']['Enums']['bill_category'];
          created_at?: string;
          currency?: string;
          extracted_json?: Json | null;
          id?: string;
          is_insurance_document?: boolean;
          is_warranty_document?: boolean;
          merchant_name?: string | null;
          source?: Database['public']['Enums']['bill_source'];
          status?: Database['public']['Enums']['bill_status'];
          storage_path?: string | null;
          total_amount?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'bills_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      line_items: {
        Row: {
          amount: number;
          bill_id: string;
          description: string;
          id: string;
        };
        Insert: {
          amount: number;
          bill_id: string;
          description: string;
          id?: string;
        };
        Update: {
          amount?: number;
          bill_id?: string;
          description?: string;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'line_items_bill_id_fkey';
            columns: ['bill_id'];
            isOneToOne: false;
            referencedRelation: 'bills';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          id: string;
          name: string | null;
          phone_number: string | null;
          subscription_tier: Database['public']['Enums']['subscription_tier'];
        };
        Insert: {
          created_at?: string;
          id: string;
          name?: string | null;
          phone_number?: string | null;
          subscription_tier?: Database['public']['Enums']['subscription_tier'];
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string | null;
          phone_number?: string | null;
          subscription_tier?: Database['public']['Enums']['subscription_tier'];
        };
        Relationships: [];
      };
      reminders: {
        Row: {
          active: boolean;
          bill_id: string;
          created_at: string;
          expiry_date: string;
          id: string;
          notified_1d: boolean;
          notified_30d: boolean;
          notified_7d: boolean;
          user_id: string;
        };
        Insert: {
          active?: boolean;
          bill_id: string;
          created_at?: string;
          expiry_date: string;
          id?: string;
          notified_1d?: boolean;
          notified_30d?: boolean;
          notified_7d?: boolean;
          user_id: string;
        };
        Update: {
          active?: boolean;
          bill_id?: string;
          created_at?: string;
          expiry_date?: string;
          id?: string;
          notified_1d?: boolean;
          notified_30d?: boolean;
          notified_7d?: boolean;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reminders_bill_id_fkey';
            columns: ['bill_id'];
            isOneToOne: false;
            referencedRelation: 'bills';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reminders_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      subscriptions: {
        Row: {
          created_at: string;
          expires_at: string | null;
          id: string;
          renewed_at: string | null;
          store: Database['public']['Enums']['subscription_store'] | null;
          tier: Database['public']['Enums']['subscription_tier'];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          renewed_at?: string | null;
          store?: Database['public']['Enums']['subscription_store'] | null;
          tier?: Database['public']['Enums']['subscription_tier'];
          user_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          renewed_at?: string | null;
          store?: Database['public']['Enums']['subscription_store'] | null;
          tier?: Database['public']['Enums']['subscription_tier'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'subscriptions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      bill_category:
        | 'Warranty'
        | 'Insurance'
        | 'Utilities'
        | 'Subscriptions'
        | 'Dining & Grocery'
        | 'Medical'
        | 'Travel'
        | 'Other';
      bill_source: 'camera' | 'share_extension' | 'whatsapp_business';
      bill_status: 'pending_review' | 'confirmed';
      subscription_store: 'app_store' | 'play_store';
      subscription_tier: 'free' | 'premium';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      bill_category: [
        'Warranty',
        'Insurance',
        'Utilities',
        'Subscriptions',
        'Dining & Grocery',
        'Medical',
        'Travel',
        'Other',
      ],
      bill_source: ['camera', 'share_extension', 'whatsapp_business'],
      bill_status: ['pending_review', 'confirmed'],
      subscription_store: ['app_store', 'play_store'],
      subscription_tier: ['free', 'premium'],
    },
  },
} as const;
