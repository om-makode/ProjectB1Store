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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      addresses: {
        Row: {
          area: string
          city: string
          created_at: string
          deleted_at: string | null
          house: string
          id: string
          is_default: boolean
          is_serviceable: boolean
          label: string
          landmark: string | null
          latitude: number | null
          location: unknown
          longitude: number | null
          pincode: string
          receiver_name: string
          receiver_phone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          area: string
          city: string
          created_at?: string
          deleted_at?: string | null
          house: string
          id?: string
          is_default?: boolean
          is_serviceable?: boolean
          label?: string
          landmark?: string | null
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          pincode: string
          receiver_name: string
          receiver_phone: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          area?: string
          city?: string
          created_at?: string
          deleted_at?: string | null
          house?: string
          id?: string
          is_default?: boolean
          is_serviceable?: boolean
          label?: string
          landmark?: string | null
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          pincode?: string
          receiver_name?: string
          receiver_phone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "addresses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity: string
          entity_id: string | null
          id: number
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: never
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          description: string | null
          is_public: boolean
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          description?: string | null
          is_public?: boolean
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          description?: string | null
          is_public?: boolean
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      banners: {
        Row: {
          created_at: string
          ends_at: string | null
          id: number
          image_path: string
          is_active: boolean
          link: Json | null
          sort_order: number
          starts_at: string | null
          store_id: number
          title: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          id?: never
          image_path: string
          is_active?: boolean
          link?: Json | null
          sort_order?: number
          starts_at?: string | null
          store_id: number
          title?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          id?: never
          image_path?: string
          is_active?: boolean
          link?: Json | null
          sort_order?: number
          starts_at?: string | null
          store_id?: number
          title?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "banners_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banners_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "v_variant_offers"
            referencedColumns: ["store_id"]
          },
        ]
      }
      brands: {
        Row: {
          created_at: string
          id: number
          logo_path: string | null
          name: Json
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: never
          logo_path?: string | null
          name: Json
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: never
          logo_path?: string | null
          name?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          body: Json
          created_at: string
          created_by: string | null
          id: number
          image_path: string | null
          last_error: string | null
          link: Json | null
          recipients: number
          scheduled_at: string | null
          segment: Json
          sent_at: string | null
          skipped_capped: number
          status: string
          title: Json
          updated_at: string
        }
        Insert: {
          body: Json
          created_at?: string
          created_by?: string | null
          id?: never
          image_path?: string | null
          last_error?: string | null
          link?: Json | null
          recipients?: number
          scheduled_at?: string | null
          segment?: Json
          sent_at?: string | null
          skipped_capped?: number
          status?: string
          title: Json
          updated_at?: string
        }
        Update: {
          body?: Json
          created_at?: string
          created_by?: string | null
          id?: never
          image_path?: string | null
          last_error?: string | null
          link?: Json | null
          recipients?: number
          scheduled_at?: string | null
          segment?: Json
          sent_at?: string | null
          skipped_capped?: number
          status?: string
          title?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_items: {
        Row: {
          created_at: string
          price_at_add: number
          quantity: number
          updated_at: string
          user_id: string
          variant_id: number
        }
        Insert: {
          created_at?: string
          price_at_add: number
          quantity: number
          updated_at?: string
          user_id: string
          variant_id: number
        }
        Update: {
          created_at?: string
          price_at_add?: number
          quantity?: number
          updated_at?: string
          user_id?: string
          variant_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_variant_offers"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      categories: {
        Row: {
          attribute_schema: Json
          color: string | null
          created_at: string
          filters: Json
          icon: string | null
          id: number
          image_path: string | null
          is_active: boolean
          name: Json
          parent_id: number | null
          schema_version: number
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          attribute_schema?: Json
          color?: string | null
          created_at?: string
          filters?: Json
          icon?: string | null
          id?: never
          image_path?: string | null
          is_active?: boolean
          name: Json
          parent_id?: number | null
          schema_version?: number
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          attribute_schema?: Json
          color?: string | null
          created_at?: string
          filters?: Json
          icon?: string | null
          id?: never
          image_path?: string | null
          is_active?: boolean
          name?: Json
          parent_id?: number | null
          schema_version?: number
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_products: {
        Row: {
          collection_id: number
          product_id: number
          sort_order: number
        }
        Insert: {
          collection_id: number
          product_id: number
          sort_order?: number
        }
        Update: {
          collection_id?: number
          product_id?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "collection_products_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "collection_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_top_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      collections: {
        Row: {
          created_at: string
          id: number
          image_path: string | null
          is_active: boolean
          slug: string
          title: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: never
          image_path?: string | null
          is_active?: boolean
          slug: string
          title: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: never
          image_path?: string | null
          is_active?: boolean
          slug?: string
          title?: Json
          updated_at?: string
        }
        Relationships: []
      }
      home_sections: {
        Row: {
          config: Json
          created_at: string
          ends_at: string | null
          id: number
          is_active: boolean
          sort_order: number
          starts_at: string | null
          store_id: number
          title: Json | null
          type: Database["public"]["Enums"]["section_type"]
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          ends_at?: string | null
          id?: never
          is_active?: boolean
          sort_order?: number
          starts_at?: string | null
          store_id: number
          title?: Json | null
          type: Database["public"]["Enums"]["section_type"]
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          ends_at?: string | null
          id?: never
          is_active?: boolean
          sort_order?: number
          starts_at?: string | null
          store_id?: number
          title?: Json | null
          type?: Database["public"]["Enums"]["section_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "home_sections_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_sections_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "v_variant_offers"
            referencedColumns: ["store_id"]
          },
        ]
      }
      inventory: {
        Row: {
          is_available: boolean
          low_stock_threshold: number
          stock: number
          store_id: number
          updated_at: string
          variant_id: number
        }
        Insert: {
          is_available?: boolean
          low_stock_threshold?: number
          stock?: number
          store_id: number
          updated_at?: string
          variant_id: number
        }
        Update: {
          is_available?: boolean
          low_stock_threshold?: number
          stock?: number
          store_id?: number
          updated_at?: string
          variant_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "v_variant_offers"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "inventory_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_variant_offers"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          actor_id: string | null
          created_at: string
          delta: number
          id: number
          note: string | null
          order_id: string | null
          reason: Database["public"]["Enums"]["stock_reason"]
          store_id: number
          variant_id: number
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          delta: number
          id?: never
          note?: string | null
          order_id?: string | null
          reason: Database["public"]["Enums"]["stock_reason"]
          store_id: number
          variant_id: number
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          delta?: number
          id?: never
          note?: string | null
          order_id?: string | null
          reason?: Database["public"]["Enums"]["stock_reason"]
          store_id?: number
          variant_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "v_variant_offers"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "inventory_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_variant_offers"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          offers: boolean
          review_prompts: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          offers?: boolean
          review_prompts?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          offers?: boolean
          review_prompts?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: Json
          created_at: string
          data: Json
          id: number
          pushed_at: string | null
          read_at: string | null
          title: Json
          type: string
          user_id: string
        }
        Insert: {
          body: Json
          created_at?: string
          data?: Json
          id?: never
          pushed_at?: string | null
          read_at?: string | null
          title: Json
          type: string
          user_id: string
        }
        Update: {
          body?: Json
          created_at?: string
          data?: Json
          id?: never
          pushed_at?: string | null
          read_at?: string | null
          title?: Json
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_issues: {
        Row: {
          created_at: string
          id: number
          message: string | null
          order_id: string
          order_item_id: number | null
          photo_paths: string[]
          resolution_note: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["issue_status"]
          type: Database["public"]["Enums"]["issue_type"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          message?: string | null
          order_id: string
          order_item_id?: number | null
          photo_paths?: string[]
          resolution_note?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["issue_status"]
          type: Database["public"]["Enums"]["issue_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          message?: string | null
          order_id?: string
          order_item_id?: number | null
          photo_paths?: string[]
          resolution_note?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["issue_status"]
          type?: Database["public"]["Enums"]["issue_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_issues_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_issues_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_issues_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          gst_rate: number
          hsn_code: string | null
          id: number
          image_path: string | null
          line_total: number
          mrp: number
          name_snapshot: Json
          order_id: string
          picked: boolean
          price: number
          product_id: number | null
          quantity: number
          status: Database["public"]["Enums"]["order_item_status"]
          variant_id: number | null
          variant_label_snapshot: Json
        }
        Insert: {
          created_at?: string
          gst_rate?: number
          hsn_code?: string | null
          id?: never
          image_path?: string | null
          line_total: number
          mrp: number
          name_snapshot: Json
          order_id: string
          picked?: boolean
          price: number
          product_id?: number | null
          quantity: number
          status?: Database["public"]["Enums"]["order_item_status"]
          variant_id?: number | null
          variant_label_snapshot: Json
        }
        Update: {
          created_at?: string
          gst_rate?: number
          hsn_code?: string | null
          id?: never
          image_path?: string | null
          line_total?: number
          mrp?: number
          name_snapshot?: Json
          order_id?: string
          picked?: boolean
          price?: number
          product_id?: number | null
          quantity?: number
          status?: Database["public"]["Enums"]["order_item_status"]
          variant_id?: number | null
          variant_label_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_top_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_variant_offers"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      order_status_events: {
        Row: {
          actor_id: string | null
          created_at: string
          id: number
          note: string | null
          order_id: string
          status: Database["public"]["Enums"]["order_status"]
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: never
          note?: string | null
          order_id: string
          status: Database["public"]["Enums"]["order_status"]
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: never
          note?: string | null
          order_id?: string
          status?: Database["public"]["Enums"]["order_status"]
        }
        Relationships: [
          {
            foreignKeyName: "order_status_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_transitions: {
        Row: {
          from_status: Database["public"]["Enums"]["order_status"]
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Insert: {
          from_status: Database["public"]["Enums"]["order_status"]
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Update: {
          from_status?: Database["public"]["Enums"]["order_status"]
          to_status?: Database["public"]["Enums"]["order_status"]
        }
        Relationships: []
      }
      orders: {
        Row: {
          address_id: string | null
          address_snapshot: Json
          amount_paid: number
          amount_refunded: number
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: Database["public"]["Enums"]["cancel_actor"] | null
          confirmed_at: string | null
          created_at: string
          customer_note: string | null
          delivered_at: string | null
          delivery_fee: number
          grand_total: number
          id: string
          idempotency_key: string
          item_total: number
          mrp_total: number
          order_number: string
          out_for_delivery_at: string | null
          packaging_fee: number
          packed_at: string | null
          payment_expires_at: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string
          review_prompt_sent_at: string | null
          small_cart_fee: number
          staff_note: string | null
          status: Database["public"]["Enums"]["order_status"]
          store_id: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address_id?: string | null
          address_snapshot: Json
          amount_paid?: number
          amount_refunded?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: Database["public"]["Enums"]["cancel_actor"] | null
          confirmed_at?: string | null
          created_at?: string
          customer_note?: string | null
          delivered_at?: string | null
          delivery_fee?: number
          grand_total: number
          id?: string
          idempotency_key: string
          item_total: number
          mrp_total: number
          order_number: string
          out_for_delivery_at?: string | null
          packaging_fee?: number
          packed_at?: string | null
          payment_expires_at?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          placed_at?: string
          review_prompt_sent_at?: string | null
          small_cart_fee?: number
          staff_note?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          store_id: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address_id?: string | null
          address_snapshot?: Json
          amount_paid?: number
          amount_refunded?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: Database["public"]["Enums"]["cancel_actor"] | null
          confirmed_at?: string | null
          created_at?: string
          customer_note?: string | null
          delivered_at?: string | null
          delivery_fee?: number
          grand_total?: number
          id?: string
          idempotency_key?: string
          item_total?: number
          mrp_total?: number
          order_number?: string
          out_for_delivery_at?: string | null
          packaging_fee?: number
          packed_at?: string | null
          payment_expires_at?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          placed_at?: string
          review_prompt_sent_at?: string | null
          small_cart_fee?: number
          staff_note?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          store_id?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "v_variant_offers"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_mismatches: {
        Row: {
          created_at: string
          details: Json | null
          id: number
          kind: string
          provider_order_id: string | null
          provider_payment_id: string | null
          resolved_at: string | null
        }
        Insert: {
          created_at?: string
          details?: Json | null
          id?: never
          kind: string
          provider_order_id?: string | null
          provider_payment_id?: string | null
          resolved_at?: string | null
        }
        Update: {
          created_at?: string
          details?: Json | null
          id?: never
          kind?: string
          provider_order_id?: string | null
          provider_payment_id?: string | null
          resolved_at?: string | null
        }
        Relationships: []
      }
      payment_webhook_events: {
        Row: {
          error: string | null
          event: string
          event_id: string
          payload: Json
          processed_at: string | null
          received_at: string
        }
        Insert: {
          error?: string | null
          event: string
          event_id: string
          payload: Json
          processed_at?: string | null
          received_at?: string
        }
        Update: {
          error?: string | null
          event?: string
          event_id?: string
          payload?: Json
          processed_at?: string | null
          received_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          error_code: string | null
          error_description: string | null
          id: string
          method: string | null
          order_id: string
          provider: string
          provider_order_id: string
          provider_payment_id: string | null
          raw: Json | null
          status: Database["public"]["Enums"]["payment_attempt_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          error_code?: string | null
          error_description?: string | null
          id?: string
          method?: string | null
          order_id: string
          provider?: string
          provider_order_id: string
          provider_payment_id?: string | null
          raw?: Json | null
          status?: Database["public"]["Enums"]["payment_attempt_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          error_code?: string | null
          error_description?: string | null
          id?: string
          method?: string | null
          order_id?: string
          provider?: string
          provider_order_id?: string
          provider_payment_id?: string | null
          raw?: Json | null
          status?: Database["public"]["Enums"]["payment_attempt_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          created_at: string
          id: number
          path: string
          product_id: number
          sort_order: number
          thumb_path: string | null
          variant_id: number | null
        }
        Insert: {
          created_at?: string
          id?: never
          path: string
          product_id: number
          sort_order?: number
          thumb_path?: string | null
          variant_id?: number | null
        }
        Update: {
          created_at?: string
          id?: never
          path?: string
          product_id?: number
          sort_order?: number
          thumb_path?: string | null
          variant_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_top_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_images_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_variant_offers"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      product_variants: {
        Row: {
          barcode: string | null
          created_at: string
          id: number
          is_active: boolean
          is_default: boolean
          label: Json
          max_per_order: number
          mrp: number
          net_quantity: number
          price: number
          product_id: number
          sku: string
          sort_order: number
          unit: string
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          created_at?: string
          id?: never
          is_active?: boolean
          is_default?: boolean
          label: Json
          max_per_order?: number
          mrp: number
          net_quantity: number
          price: number
          product_id: number
          sku: string
          sort_order?: number
          unit: string
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          created_at?: string
          id?: never
          is_active?: boolean
          is_default?: boolean
          label?: Json
          max_per_order?: number
          mrp?: number
          net_quantity?: number
          price?: number
          product_id?: number
          sku?: string
          sort_order?: number
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_top_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      products: {
        Row: {
          attributes: Json
          brand_id: number | null
          category_id: number
          country_of_origin: string
          created_at: string
          description: Json | null
          gst_rate: number
          hsn_code: string | null
          id: number
          is_active: boolean
          is_veg: boolean | null
          manufacturer: Json | null
          name: Json
          rating_avg: number
          rating_count: number
          search_text: string
          shelf_life: string | null
          slug: string
          sort_order: number
          tags: string[]
          updated_at: string
        }
        Insert: {
          attributes?: Json
          brand_id?: number | null
          category_id: number
          country_of_origin?: string
          created_at?: string
          description?: Json | null
          gst_rate?: number
          hsn_code?: string | null
          id?: never
          is_active?: boolean
          is_veg?: boolean | null
          manufacturer?: Json | null
          name: Json
          rating_avg?: number
          rating_count?: number
          search_text?: string
          shelf_life?: string | null
          slug: string
          sort_order?: number
          tags?: string[]
          updated_at?: string
        }
        Update: {
          attributes?: Json
          brand_id?: number | null
          category_id?: number
          country_of_origin?: string
          created_at?: string
          description?: Json | null
          gst_rate?: number
          hsn_code?: string | null
          id?: never
          is_active?: boolean
          is_veg?: boolean | null
          manufacturer?: Json | null
          name?: Json
          rating_avg?: number
          rating_count?: number
          search_text?: string
          shelf_life?: string | null
          slug?: string
          sort_order?: number
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          cod_allowed: boolean
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_blocked: boolean
          language: string
          phone: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          cod_allowed?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_blocked?: boolean
          language?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          cod_allowed?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_blocked?: boolean
          language?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          platform: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          hits: number
          key: string
          window_start: string
        }
        Insert: {
          hits?: number
          key: string
          window_start: string
        }
        Update: {
          hits?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      refunds: {
        Row: {
          amount: number
          attempts: number
          created_at: string
          id: string
          last_error: string | null
          order_id: string
          payment_id: string
          provider_refund_id: string | null
          reason: string
          resolved_note: string | null
          status: Database["public"]["Enums"]["refund_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          order_id: string
          payment_id: string
          provider_refund_id?: string | null
          reason: string
          resolved_note?: string | null
          status?: Database["public"]["Enums"]["refund_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          order_id?: string
          payment_id?: string
          provider_refund_id?: string | null
          reason?: string
          resolved_note?: string | null
          status?: Database["public"]["Enums"]["refund_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          comment: string | null
          created_at: string
          hidden_reason: string | null
          is_hidden: boolean
          language: string | null
          order_id: string
          product_id: number
          rating: number
          reviewer_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          hidden_reason?: string | null
          is_hidden?: boolean
          language?: string | null
          order_id: string
          product_id: number
          rating: number
          reviewer_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          hidden_reason?: string | null
          is_hidden?: boolean
          language?: string | null
          order_id?: string
          product_id?: number
          rating?: number
          reviewer_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_top_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      search_queries: {
        Row: {
          created_at: string
          id: number
          language: string | null
          normalized: string
          query: string
          requested: boolean
          results_count: number
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: never
          language?: string | null
          normalized: string
          query: string
          requested?: boolean
          results_count: number
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: never
          language?: string | null
          normalized?: string
          query?: string
          requested?: boolean
          results_count?: number
          user_id?: string | null
        }
        Relationships: []
      }
      search_synonyms: {
        Row: {
          created_at: string
          id: number
          maps_to: string
          term: string
        }
        Insert: {
          created_at?: string
          id?: never
          maps_to: string
          term: string
        }
        Update: {
          created_at?: string
          id?: never
          maps_to?: string
          term?: string
        }
        Relationships: []
      }
      stock_alerts: {
        Row: {
          created_at: string
          notified_at: string | null
          triggered_at: string | null
          user_id: string
          variant_id: number
        }
        Insert: {
          created_at?: string
          notified_at?: string | null
          triggered_at?: string | null
          user_id: string
          variant_id: number
        }
        Update: {
          created_at?: string
          notified_at?: string | null
          triggered_at?: string | null
          user_id?: string
          variant_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_alerts_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_alerts_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_variant_offers"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      stores: {
        Row: {
          address: Json
          auto_cancel_minutes: number
          busy_message: Json | null
          city: string
          created_at: string
          delivery_fee: number
          eta_minutes: number
          free_delivery_above: number
          fssai_license: string | null
          gstin: string | null
          id: number
          is_accepting_orders: boolean
          is_active: boolean
          location: unknown
          max_cod_order_value: number
          max_open_orders_per_user: number
          min_order_value: number
          name: Json
          opening_hours: Json
          packaging_fee: number
          payment_hold_minutes: number
          phone: string
          service_area: unknown
          service_radius_km: number
          serviceable_pincodes: string[]
          small_cart_fee: number
          small_cart_threshold: number
          timezone: string
          updated_at: string
          upi_enabled: boolean
          whatsapp: string | null
        }
        Insert: {
          address: Json
          auto_cancel_minutes?: number
          busy_message?: Json | null
          city: string
          created_at?: string
          delivery_fee?: number
          eta_minutes?: number
          free_delivery_above?: number
          fssai_license?: string | null
          gstin?: string | null
          id?: never
          is_accepting_orders?: boolean
          is_active?: boolean
          location: unknown
          max_cod_order_value?: number
          max_open_orders_per_user?: number
          min_order_value?: number
          name: Json
          opening_hours?: Json
          packaging_fee?: number
          payment_hold_minutes?: number
          phone: string
          service_area?: unknown
          service_radius_km?: number
          serviceable_pincodes?: string[]
          small_cart_fee?: number
          small_cart_threshold?: number
          timezone?: string
          updated_at?: string
          upi_enabled?: boolean
          whatsapp?: string | null
        }
        Update: {
          address?: Json
          auto_cancel_minutes?: number
          busy_message?: Json | null
          city?: string
          created_at?: string
          delivery_fee?: number
          eta_minutes?: number
          free_delivery_above?: number
          fssai_license?: string | null
          gstin?: string | null
          id?: never
          is_accepting_orders?: boolean
          is_active?: boolean
          location?: unknown
          max_cod_order_value?: number
          max_open_orders_per_user?: number
          min_order_value?: number
          name?: Json
          opening_hours?: Json
          packaging_fee?: number
          payment_hold_minutes?: number
          phone?: string
          service_area?: unknown
          service_radius_km?: number
          serviceable_pincodes?: string[]
          small_cart_fee?: number
          small_cart_threshold?: number
          timezone?: string
          updated_at?: string
          upi_enabled?: boolean
          whatsapp?: string | null
        }
        Relationships: []
      }
      wishlist: {
        Row: {
          created_at: string
          product_id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          product_id: number
          user_id: string
        }
        Update: {
          created_at?: string
          product_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlist_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "wishlist_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_top_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "wishlist_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_cancellations: {
        Row: {
          cancelled_by: Database["public"]["Enums"]["cancel_actor"] | null
          last_at: string | null
          orders: number | null
          reason: string | null
          value: number | null
        }
        Relationships: []
      }
      v_low_stock: {
        Row: {
          days_of_cover: number | null
          is_available: boolean | null
          label: Json | null
          low_stock_threshold: number | null
          name: Json | null
          product_id: number | null
          sku: string | null
          sold_7d: number | null
          stock: number | null
          store_id: number | null
          variant_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "v_variant_offers"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "inventory_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_variant_offers"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      v_ops_health: {
        Row: {
          auto_cancelled_last_hour: number | null
          last_staff_token_seen: string | null
          out_of_stock_variants: number | null
          unaccepted_over_5m: number | null
        }
        Relationships: []
      }
      v_payments_daily: {
        Row: {
          amount_captured: number | null
          amount_refunded: number | null
          day: string | null
          payments_captured: number | null
          payments_failed: number | null
        }
        Relationships: []
      }
      v_sales_daily: {
        Row: {
          avg_order_value: number | null
          cancelled: number | null
          customers: number | null
          day: string | null
          delivered_revenue: number | null
          order_value: number | null
          orders: number | null
        }
        Relationships: []
      }
      v_top_products: {
        Row: {
          name: Json | null
          orders: number | null
          product_id: number | null
          revenue: number | null
          slug: string | null
          units: number | null
        }
        Relationships: []
      }
      v_variant_offers: {
        Row: {
          available_qty: number | null
          discount_pct: number | null
          is_active: boolean | null
          is_default: boolean | null
          label: Json | null
          low_stock: boolean | null
          max_per_order: number | null
          mrp: number | null
          net_quantity: number | null
          price: number | null
          product_id: number | null
          sort_order: number | null
          store_id: number | null
          unit: string | null
          variant_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_top_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      v_zero_result_searches: {
        Row: {
          languages: string[] | null
          last_searched_at: string | null
          query: string | null
          searches: number | null
          users: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _cancel_order_internal: {
        Args: {
          p_actor: Database["public"]["Enums"]["cancel_actor"]
          p_actor_id: string
          p_order_id: string
          p_reason: string
        }
        Returns: {
          address_id: string | null
          address_snapshot: Json
          amount_paid: number
          amount_refunded: number
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: Database["public"]["Enums"]["cancel_actor"] | null
          confirmed_at: string | null
          created_at: string
          customer_note: string | null
          delivered_at: string | null
          delivery_fee: number
          grand_total: number
          id: string
          idempotency_key: string
          item_total: number
          mrp_total: number
          order_number: string
          out_for_delivery_at: string | null
          packaging_fee: number
          packed_at: string | null
          payment_expires_at: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string
          review_prompt_sent_at: string | null
          small_cart_fee: number
          staff_note: string | null
          status: Database["public"]["Enums"]["order_status"]
          store_id: number
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_add_product_images: {
        Args: { p_images: Json; p_sku: string }
        Returns: number
      }
      admin_dashboard_today: { Args: never; Returns: Json }
      admin_import_products: {
        Args: { p_dry_run?: boolean; p_rows: Json }
        Returns: Json
      }
      admin_list_users: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_query?: string
          p_role?: Database["public"]["Enums"]["app_role"]
        }
        Returns: {
          cancelled_count: number
          cod_allowed: boolean
          created_at: string
          delivered_count: number
          email: string
          full_name: string
          id: string
          is_blocked: boolean
          last_order_at: string
          orders_count: number
          phone: string
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      admin_preview_campaign_audience: {
        Args: { p_segment: Json }
        Returns: Json
      }
      admin_products_missing_attribute: {
        Args: { p_category_id: number; p_key: string }
        Returns: number
      }
      admin_reorder: {
        Args: { p_ids: number[]; p_table: string }
        Returns: undefined
      }
      admin_resolve_refund: {
        Args: { p_note: string; p_refund_id: string }
        Returns: {
          amount: number
          attempts: number
          created_at: string
          id: string
          last_error: string | null
          order_id: string
          payment_id: string
          provider_refund_id: string | null
          reason: string
          resolved_note: string | null
          status: Database["public"]["Enums"]["refund_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "refunds"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_send_campaign: {
        Args: { p_campaign_id: number; p_test?: boolean }
        Returns: Json
      }
      admin_set_collection_products: {
        Args: { p_collection_id: number; p_product_ids: number[] }
        Returns: undefined
      }
      admin_set_role: {
        Args: {
          p_role: Database["public"]["Enums"]["app_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      admin_set_user_blocked: {
        Args: {
          p_blocked: boolean
          p_cod_allowed?: boolean
          p_note?: string
          p_user_id: string
        }
        Returns: undefined
      }
      admin_update_store_settings: {
        Args: { p_patch: Json; p_store_id: number }
        Returns: Json
      }
      admin_upsert_product: { Args: { payload: Json }; Returns: Json }
      auto_cancel_stale_orders: { Args: never; Returns: number }
      buy_again: {
        Args: { p_limit?: number }
        Returns: {
          in_stock: boolean
          is_veg: boolean
          last_bought_at: string
          max_per_order: number
          mrp: number
          price: number
          product_id: number
          product_name: Json
          product_slug: string
          stock: number
          thumb_path: string
          times_bought: number
          variant_id: number
          variant_label: Json
        }[]
      }
      campaign_audience: {
        Args: { p_segment: Json }
        Returns: {
          recipient_id: string
        }[]
      }
      campaign_recipients: {
        Args: { p_segment: Json }
        Returns: {
          capped: boolean
          recipient_id: string
        }[]
      }
      cancel_order: {
        Args: { p_order_id: string; p_reason: string }
        Returns: {
          address_id: string | null
          address_snapshot: Json
          amount_paid: number
          amount_refunded: number
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: Database["public"]["Enums"]["cancel_actor"] | null
          confirmed_at: string | null
          created_at: string
          customer_note: string | null
          delivered_at: string | null
          delivery_fee: number
          grand_total: number
          id: string
          idempotency_key: string
          item_total: number
          mrp_total: number
          order_number: string
          out_for_delivery_at: string | null
          packaging_fee: number
          packed_at: string | null
          payment_expires_at: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string
          review_prompt_sent_at: string | null
          small_cart_fee: number
          staff_note: string | null
          status: Database["public"]["Enums"]["order_status"]
          store_id: number
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      catalog_product_cards: {
        Args: { p_product_ids: number[]; p_store_id: number }
        Returns: Json
      }
      category_filter_options: {
        Args: { p_category_id: number; p_store_id?: number }
        Returns: Json
      }
      check_rate_limit: {
        Args: { p_key: string; p_max: number; p_window: string }
        Returns: undefined
      }
      check_serviceability: {
        Args: { p_lat: number; p_lng: number }
        Returns: Json
      }
      claim_pending_push: {
        Args: { p_limit?: number }
        Returns: {
          body: Json
          data: Json
          language: string
          notification_id: number
          title: Json
          tokens: string[]
          type: string
        }[]
      }
      confirm_payment: {
        Args: {
          p_amount_paise: number
          p_method: string
          p_provider_order_id: string
          p_provider_payment_id: string
          p_raw: Json
        }
        Returns: string
      }
      csv_attributes: {
        Args: { p_category_id: number; p_row: Json }
        Returns: Json
      }
      csv_bool: { Args: { p_value: string }; Returns: boolean }
      csv_localized: { Args: { p_prefix: string; p_row: Json }; Returns: Json }
      default_store_id: { Args: never; Returns: number }
      delete_address: { Args: { p_address_id: string }; Returns: undefined }
      delete_my_account: { Args: never; Returns: undefined }
      effective_attribute_schema: {
        Args: { p_category_id: number }
        Returns: Json
      }
      expand_search_terms: { Args: { p_q: string }; Returns: string[] }
      fail_payment: {
        Args: {
          p_code: string
          p_description: string
          p_provider_order_id: string
          p_raw: Json
        }
        Returns: undefined
      }
      fix_cart: { Args: never; Returns: undefined }
      get_cart_quote: {
        Args: {
          p_address_id?: string
          p_payment_method?: Database["public"]["Enums"]["payment_method"]
        }
        Returns: Json
      }
      get_home: {
        Args: { p_lang?: string; p_store_id?: number }
        Returns: Json
      }
      get_product: {
        Args: { p_slug: string; p_store_id?: number }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      is_localized: { Args: { v: Json }; Returns: boolean }
      is_localized_text: {
        Args: { require_en?: boolean; v: Json }
        Returns: boolean
      }
      is_quiet_hours: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      list_collection_products: {
        Args: {
          p_page?: number
          p_size?: number
          p_slug: string
          p_store_id?: number
        }
        Returns: Json
      }
      list_products: {
        Args: {
          p_category_id: number
          p_filters?: Json
          p_page?: number
          p_size?: number
          p_sort?: string
          p_store_id?: number
        }
        Returns: Json
      }
      log_search: {
        Args: {
          p_lang: string
          p_query: string
          p_requested?: boolean
          p_results_count: number
        }
        Returns: undefined
      }
      mark_notifications_read: { Args: { p_ids?: number[] }; Returns: number }
      mark_refund_result: {
        Args: {
          p_error: string
          p_provider_refund_id: string
          p_status: Database["public"]["Enums"]["refund_status"]
        }
        Returns: undefined
      }
      merge_guest_cart: { Args: { p_items: Json }; Returns: number }
      normalize_search: { Args: { v: string }; Returns: string }
      notify_staff: {
        Args: {
          p_body: Json
          p_data?: Json
          p_store_id: number
          p_title: Json
          p_type: string
        }
        Returns: undefined
      }
      order_review_items: {
        Args: { p_order_id: string }
        Returns: {
          my_comment: string
          my_rating: number
          product_id: number
          product_name: Json
          product_slug: string
          thumb_path: string
          variant_label: Json
        }[]
      }
      order_status_message: {
        Args: {
          p_cancelled_by: Database["public"]["Enums"]["cancel_actor"]
          p_order_number: string
          p_status: Database["public"]["Enums"]["order_status"]
        }
        Returns: Json
      }
      place_order: {
        Args: {
          p_address_id: string
          p_customer_note: string
          p_expected_total?: number
          p_idempotency_key: string
          p_payment_method: Database["public"]["Enums"]["payment_method"]
        }
        Returns: Json
      }
      product_matches_filters: {
        Args: {
          p_attributes: Json
          p_available: number
          p_brand_id: number
          p_filters: Json
          p_is_veg: boolean
          p_price: number
        }
        Returns: boolean
      }
      queue_review_prompts: { Args: never; Returns: number }
      quote_guest_cart: { Args: { p_items: Json }; Returns: Json }
      register_push_token: {
        Args: { p_platform: string; p_token: string }
        Returns: undefined
      }
      related_products: {
        Args: {
          p_kind?: string
          p_limit?: number
          p_product_id: number
          p_store_id?: number
        }
        Returns: Json
      }
      release_expired_payment_holds: { Args: never; Returns: number }
      reorder_to_cart: { Args: { p_order_id: string }; Returns: Json }
      report_order_issue: {
        Args: {
          p_message: string
          p_order_id: string
          p_order_item_id?: number
          p_photo_paths?: string[]
          p_type: Database["public"]["Enums"]["issue_type"]
        }
        Returns: {
          created_at: string
          id: number
          message: string | null
          order_id: string
          order_item_id: number | null
          photo_paths: string[]
          resolution_note: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["issue_status"]
          type: Database["public"]["Enums"]["issue_type"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "order_issues"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_ip: { Args: never; Returns: string }
      run_scheduled_campaigns: { Args: never; Returns: number }
      search_products: {
        Args: {
          p_filters?: Json
          p_lang?: string
          p_page?: number
          p_q: string
          p_size?: number
          p_store_id?: number
        }
        Returns: Json
      }
      search_suggestions: {
        Args: { p_limit?: number; p_q: string }
        Returns: Json
      }
      send_campaign_internal: {
        Args: { p_campaign_id: number }
        Returns: number
      }
      set_cart_quantity: {
        Args: { p_quantity: number; p_variant_id: number }
        Returns: Json
      }
      slugify: { Args: { p_text: string }; Returns: string }
      staff_adjust_stock: {
        Args: {
          p_delta: number
          p_note?: string
          p_reason: Database["public"]["Enums"]["stock_reason"]
          p_store_id: number
          p_variant_id: number
        }
        Returns: {
          is_available: boolean
          low_stock_threshold: number
          stock: number
          store_id: number
          updated_at: string
          variant_id: number
        }
        SetofOptions: {
          from: "*"
          to: "inventory"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      staff_list_board: {
        Args: { p_store_id: number }
        Returns: {
          area: string
          auto_cancel_at: string
          customer_cancels_30d: number
          grand_total: number
          has_note: boolean
          id: string
          is_first_order: boolean
          item_count: number
          order_number: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          picked_count: number
          placed_at: string
          receiver_name: string
          status: Database["public"]["Enums"]["order_status"]
          unavailable_count: number
          updated_at: string
        }[]
      }
      staff_list_stock: {
        Args: {
          p_filter?: string
          p_page?: number
          p_q?: string
          p_store_id: number
        }
        Returns: {
          barcode: string
          is_available: boolean
          low_stock_threshold: number
          mrp: number
          price: number
          product_id: number
          product_name: Json
          sku: string
          stock: number
          thumb_path: string
          updated_at: string
          variant_id: number
          variant_label: Json
        }[]
      }
      staff_mark_item_unavailable: {
        Args: { p_order_item_id: number; p_reason: string }
        Returns: {
          address_id: string | null
          address_snapshot: Json
          amount_paid: number
          amount_refunded: number
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: Database["public"]["Enums"]["cancel_actor"] | null
          confirmed_at: string | null
          created_at: string
          customer_note: string | null
          delivered_at: string | null
          delivery_fee: number
          grand_total: number
          id: string
          idempotency_key: string
          item_total: number
          mrp_total: number
          order_number: string
          out_for_delivery_at: string | null
          packaging_fee: number
          packed_at: string | null
          payment_expires_at: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string
          review_prompt_sent_at: string | null
          small_cart_fee: number
          staff_note: string | null
          status: Database["public"]["Enums"]["order_status"]
          store_id: number
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      staff_receive_stock: {
        Args: { p_items: Json; p_note?: string; p_store_id: number }
        Returns: number
      }
      staff_resolve_issue: {
        Args: {
          p_issue_id: number
          p_note: string
          p_status: Database["public"]["Enums"]["issue_status"]
        }
        Returns: {
          created_at: string
          id: number
          message: string | null
          order_id: string
          order_item_id: number | null
          photo_paths: string[]
          resolution_note: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["issue_status"]
          type: Database["public"]["Enums"]["issue_type"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "order_issues"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      staff_set_available: {
        Args: { p_available: boolean; p_store_id: number; p_variant_id: number }
        Returns: {
          is_available: boolean
          low_stock_threshold: number
          stock: number
          store_id: number
          updated_at: string
          variant_id: number
        }
        SetofOptions: {
          from: "*"
          to: "inventory"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      staff_set_order_note: {
        Args: { p_note: string; p_order_id: string }
        Returns: {
          address_id: string | null
          address_snapshot: Json
          amount_paid: number
          amount_refunded: number
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: Database["public"]["Enums"]["cancel_actor"] | null
          confirmed_at: string | null
          created_at: string
          customer_note: string | null
          delivered_at: string | null
          delivery_fee: number
          grand_total: number
          id: string
          idempotency_key: string
          item_total: number
          mrp_total: number
          order_number: string
          out_for_delivery_at: string | null
          packaging_fee: number
          packed_at: string | null
          payment_expires_at: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string
          review_prompt_sent_at: string | null
          small_cart_fee: number
          staff_note: string | null
          status: Database["public"]["Enums"]["order_status"]
          store_id: number
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      staff_set_order_status: {
        Args: {
          p_note?: string
          p_order_id: string
          p_status: Database["public"]["Enums"]["order_status"]
        }
        Returns: {
          address_id: string | null
          address_snapshot: Json
          amount_paid: number
          amount_refunded: number
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: Database["public"]["Enums"]["cancel_actor"] | null
          confirmed_at: string | null
          created_at: string
          customer_note: string | null
          delivered_at: string | null
          delivery_fee: number
          grand_total: number
          id: string
          idempotency_key: string
          item_total: number
          mrp_total: number
          order_number: string
          out_for_delivery_at: string | null
          packaging_fee: number
          packed_at: string | null
          payment_expires_at: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string
          review_prompt_sent_at: string | null
          small_cart_fee: number
          staff_note: string | null
          status: Database["public"]["Enums"]["order_status"]
          store_id: number
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      staff_set_stock: {
        Args: {
          p_note?: string
          p_stock: number
          p_store_id: number
          p_variant_id: number
        }
        Returns: {
          is_available: boolean
          low_stock_threshold: number
          stock: number
          store_id: number
          updated_at: string
          variant_id: number
        }
        SetofOptions: {
          from: "*"
          to: "inventory"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      staff_set_store_open: {
        Args: {
          p_accepting: boolean
          p_busy_message?: Json
          p_eta_minutes?: number
          p_store_id: number
        }
        Returns: {
          address: Json
          auto_cancel_minutes: number
          busy_message: Json | null
          city: string
          created_at: string
          delivery_fee: number
          eta_minutes: number
          free_delivery_above: number
          fssai_license: string | null
          gstin: string | null
          id: number
          is_accepting_orders: boolean
          is_active: boolean
          location: unknown
          max_cod_order_value: number
          max_open_orders_per_user: number
          min_order_value: number
          name: Json
          opening_hours: Json
          packaging_fee: number
          payment_hold_minutes: number
          phone: string
          service_area: unknown
          service_radius_km: number
          serviceable_pincodes: string[]
          small_cart_fee: number
          small_cart_threshold: number
          timezone: string
          updated_at: string
          upi_enabled: boolean
          whatsapp: string | null
        }
        SetofOptions: {
          from: "*"
          to: "stores"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      staff_today_summary: { Args: { p_store_id: number }; Returns: Json }
      staff_toggle_picked: {
        Args: { p_order_item_id: number; p_picked: boolean }
        Returns: {
          address_id: string | null
          address_snapshot: Json
          amount_paid: number
          amount_refunded: number
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: Database["public"]["Enums"]["cancel_actor"] | null
          confirmed_at: string | null
          created_at: string
          customer_note: string | null
          delivered_at: string | null
          delivery_fee: number
          grand_total: number
          id: string
          idempotency_key: string
          item_total: number
          mrp_total: number
          order_number: string
          out_for_delivery_at: string | null
          packaging_fee: number
          packed_at: string | null
          payment_expires_at: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string
          review_prompt_sent_at: string | null
          small_cart_fee: number
          staff_note: string | null
          status: Database["public"]["Enums"]["order_status"]
          store_id: number
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      store_status: { Args: { p_store_id?: number }; Returns: Json }
      submit_review: {
        Args: {
          p_comment?: string
          p_language?: string
          p_product_id: number
          p_rating: number
        }
        Returns: {
          comment: string | null
          created_at: string
          hidden_reason: string | null
          is_hidden: boolean
          language: string | null
          order_id: string
          product_id: number
          rating: number
          reviewer_name: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "reviews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      switch_order_to_cod: { Args: { p_order_id: string }; Returns: Json }
      toggle_stock_alert: {
        Args: { p_on: boolean; p_variant_id: number }
        Returns: boolean
      }
      trending_searches: { Args: { p_limit?: number }; Returns: Json }
      unregister_push_token: { Args: { p_token: string }; Returns: undefined }
      validate_attributes: {
        Args: { p_attrs: Json; p_schema: Json }
        Returns: string[]
      }
    }
    Enums: {
      app_role: "customer" | "staff" | "admin"
      cancel_actor: "customer" | "store" | "system"
      issue_status: "open" | "resolved" | "rejected"
      issue_type:
        | "missing_item"
        | "damaged"
        | "wrong_item"
        | "quality"
        | "other"
      order_item_status: "active" | "unavailable"
      order_status:
        | "awaiting_payment"
        | "placed"
        | "confirmed"
        | "packing"
        | "packed"
        | "out_for_delivery"
        | "delivered"
        | "cancelled"
      payment_attempt_status: "created" | "authorized" | "captured" | "failed"
      payment_method: "cod" | "upi"
      payment_status:
        | "pending"
        | "paid"
        | "partially_refunded"
        | "failed"
        | "refunded"
      refund_status: "pending" | "processing" | "processed" | "failed"
      section_type:
        | "banner_carousel"
        | "category_grid"
        | "product_rail"
        | "collection_rail"
        | "buy_again"
      stock_reason:
        | "order"
        | "order_cancel"
        | "item_unavailable"
        | "restock"
        | "adjustment"
        | "damage"
        | "initial"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["customer", "staff", "admin"],
      cancel_actor: ["customer", "store", "system"],
      issue_status: ["open", "resolved", "rejected"],
      issue_type: ["missing_item", "damaged", "wrong_item", "quality", "other"],
      order_item_status: ["active", "unavailable"],
      order_status: [
        "awaiting_payment",
        "placed",
        "confirmed",
        "packing",
        "packed",
        "out_for_delivery",
        "delivered",
        "cancelled",
      ],
      payment_attempt_status: ["created", "authorized", "captured", "failed"],
      payment_method: ["cod", "upi"],
      payment_status: [
        "pending",
        "paid",
        "partially_refunded",
        "failed",
        "refunded",
      ],
      refund_status: ["pending", "processing", "processed", "failed"],
      section_type: [
        "banner_carousel",
        "category_grid",
        "product_rail",
        "collection_rail",
        "buy_again",
      ],
      stock_reason: [
        "order",
        "order_cancel",
        "item_unavailable",
        "restock",
        "adjustment",
        "damage",
        "initial",
      ],
    },
  },
} as const
