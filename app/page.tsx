"use client";

import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { 
  Package, Calculator, Minus, Plus, ShoppingBag, 
  Send, CheckCircle2, TrendingUp 
} from 'lucide-react';

// ==========================================
// PENGATURAN ADMIN WA
// ==========================================
const ADMIN_WA_NUMBER = "6287788472837"; // GANTI DENGAN NOMOR WA BOS

// ==========================================
// DATABASE HARGA BAKU (SMART DETECTOR)
// ==========================================
// Sistem ini kebal terhadap typo atau perbedaan huruf besar/kecil di database
const getPriceConfig = (dbName: string) => {
  const name = dbName.toLowerCase();
  
  // Logika pengecekan kata kunci otomatis
  if (name.includes('besar') && name.includes('10')) return { hargaReseller: 31000, hargaJual: 35000 };
  if (name.includes('isi 15')) return { hargaReseller: 26000, hargaJual: 30000 };
  if (name.includes('isi 20')) return { hargaReseller: 31000, hargaJual: 35000 };
  if (name.includes('isi 10')) return { hargaReseller: 17000, hargaJual: 20000 }; // Dieksekusi setelah 'besar 10'
  if (name.includes('selam')) return { hargaReseller: 24000, hargaJual: 28000 };
  if (name.includes('tekwan')) return { hargaReseller: 31000, hargaJual: 35000 };
  if (name.includes('adaan') || name.includes('kulit')) return { hargaReseller: 17000, hargaJual: 20000 };
  if (name.includes('cuko')) return { hargaReseller: 10000, hargaJual: 12000 };
  
  return { hargaReseller: 20000, hargaJual: 25000 }; // Harga Jaga-jaga
};


// Tipe data produk
interface ProductInfo {
  name: string;
  stock: number;
  price: number; // Harga Beli Reseller
  het: number;   // Harga Jual ke Konsumen (HET)
}

export default function ResellerDashboard() {
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchLiveStock();
  }, []);

  // ==========================================
  // LOGIKA TARIK DATA AMAN (DISAMAKAN 100% DENGAN ADMIN)
  // ==========================================
  async function fetchLiveStock() {
    try {
      // 1. Tarik semua data Batch & Transaksi (Persis seperti Admin)
      const [batchesRes, trxRes] = await Promise.all([
        supabase.from('batches').select('product_name, total_qty, status, is_archived'),
        supabase.from('transactions').select('product_name, qty')
      ]);

      if (batchesRes.error) throw batchesRes.error;
      if (trxRes.error) throw trxRes.error;

      const batchesData = batchesRes.data || [];
      const trxData = trxRes.data || [];

      // 2. Gunakan Logika "stockMap" yang persis sama dengan Admin Dashboard
      const stockMap: Record<string, { in: number, out: number, displayName: string, isArchived: boolean }> = {};

      batchesData.forEach(b => {
        // PERBAIKAN: Potong teks jika ada embel-embel " | "
        const rawName = (b.product_name || 'Pempek Campur').split(' | ')[0];
        const key = rawName.trim().toLowerCase();

        // Filter produk khusus yang tidak perlu tampil
        if (key.includes('baso') || key === 'pempek') return;

        if (!stockMap[key]) {
          stockMap[key] = { in: 0, out: 0, displayName: rawName.trim(), isArchived: true };
        }

        // Hitung total masuk (abaikan yang Sold Out)
        const status = (b.status || '').toLowerCase();
        if (status !== 'sold out') {
          stockMap[key].in += Number(b.total_qty || 0);
        }

        // Cek status arsip
        if (b.is_archived === false && !status.includes('archive')) {
          stockMap[key].isArchived = false;
        }
      });

      // 3. Kurangi dengan Total Keluar (berdasarkan NAMA, bukan batch_id)
      trxData.forEach(t => {
        // PERBAIKAN: Potong teks jika ada embel-embel paket " | "
        const rawName = (t.product_name || 'Pempek Campur').split(' | ')[0];
        const key = rawName.trim().toLowerCase();

        // Hanya kurangi jika produknya ada di stockMap
        if (stockMap[key]) {
          stockMap[key].out += Number(t.qty || 0);
        }
      });

      // 4. Tahap Akhir: Susun data khusus layar Reseller
      const finalProducts = Object.values(stockMap)
        .filter(item => item.isArchived === false) // Sembunyikan yang di-arsip
        .map(item => {
          const name = item.displayName;
          const stock = item.in - item.out;

          // Tarik harga otomatis pakai Smart Detector
          const config = getPriceConfig(name);
          const price = config.hargaReseller;
          const het = config.hargaJual;

          return { name, stock, price, het };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      setProducts(finalProducts);

    } catch (error) {
      console.error('Error fetching live stock:', error);
      alert('Gagal memuat data freezer. Pastikan koneksi internet stabil.');
    } finally {
      setLoading(false);
    }
  }

  // ==========================================
  // LOGIKA KERANJANG BELANJA (CART)
  // ==========================================
  const updateCart = (name: string, delta: number, maxStock: number) => {
    setCart(prev => {
      const current = prev[name] || 0;
      let newVal = current + delta;
      
      if (newVal < 0) newVal = 0;
      if (newVal > maxStock) newVal = maxStock;
      
      return { ...prev, [name]: newVal };
    });
  };

  // Kalkulasi Total Pembayaran & Potensi Untung
  let totalQty = 0;
  let totalHargaNormal = 0;
  let totalExpectedProfit = 0;

  products.forEach(p => {
    const qty = cart[p.name] || 0;
    if (qty > 0) {
      totalQty += qty;
      totalHargaNormal += (p.price * qty);
      
      // Untung per item = Harga Jual - Modal Reseller
      totalExpectedProfit += (p.het - p.price) * qty;
    }
  });

  // ==========================================
  // FITUR WHATSAPP ORDER GENERATOR
  // ==========================================
  const sendOrderToWhatsApp = () => {
    if (totalQty === 0) return;

    let message = `*HALO ADMIN PEMPEK UMIWA* 🐟\n`;
    message += `Saya mau setor PO/Orderan Reseller nih:\n\n`;
    message += `*RINCIAN PESANAN:*\n`;

    products.forEach(p => {
      const qty = cart[p.name] || 0;
      if (qty > 0) message += `▪️ ${qty}x ${p.name}\n`;
    });

    message += `\n------------------------\n`;
    message += `*Total Pack:* ${totalQty} Pack\n`;
    message += `*TOTAL TAGIHAN:* *Rp ${totalHargaNormal.toLocaleString('id-ID')}*\n`;
    message += `------------------------\n\n`;
    message += `Tolong siapkan barangnya ya, nanti saya info untuk pengambilannya. Terima kasih! 🙏`;

    const encodedMessage = encodeURIComponent(message);
    window.open(`https://wa.me/${ADMIN_WA_NUMBER}?text=${encodedMessage}`, '_blank');
  };

  const formatIDR = (num: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(num);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 text-emerald-600">
        <Package className="w-12 h-12 animate-bounce mb-3" />
        <p className="font-bold animate-pulse">Mengecek Freezer Umiwa...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-44 font-sans text-slate-800 relative selection:bg-emerald-200">
      
      {/* HEADER KHUSUS RESELLER */}
      <header className="bg-emerald-600 text-white p-6 shadow-md rounded-b-3xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-10">
          <ShoppingBag className="w-24 h-24" />
        </div>
        <h1 className="text-2xl font-black relative z-10">Kalkulator Mitra</h1>
        <p className="text-emerald-100 text-xs mt-1 relative z-10 flex items-center">
          <CheckCircle2 className="w-3 h-3 mr-1" /> Pempek Umiwa Official
        </p>
      </header>

      <main className="p-4 max-w-md mx-auto space-y-6 mt-4">
        
        {/* SECTION 1: LIVE STOK */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center gap-2 mb-4 border-b border-slate-50 pb-3">
            <Package className="text-emerald-600" size={20} />
            <h2 className="text-lg font-black text-slate-800">Sisa Stok Saat Ini</h2>
          </div>
          
          <div className="space-y-3">
            {products.length === 0 ? (
              <p className="text-center text-sm text-slate-400 py-4 italic">Freezer sedang kosong. Menunggu restock...</p>
            ) : (
              products.map((p) => {
                const isHabis = p.stock <= 0;
                
                return (
                  <div key={`stock-${p.name}`} className={`flex justify-between items-center p-2 rounded-xl transition-all ${isHabis ? 'bg-slate-50 opacity-60' : ''}`}>
                    <span className={`text-sm font-medium ${isHabis ? 'text-slate-400 line-through' : 'text-slate-600'}`}>{p.name}</span>
                    <span className={`font-black text-xs px-2.5 py-1 rounded-lg ${
                      isHabis ? 'bg-rose-100 text-rose-600 border border-rose-200' :
                      p.stock > 10 ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 
                      'bg-orange-50 text-orange-700 border border-orange-100'
                    }`}>
                      {isHabis ? 'HABIS' : `${p.stock} Pack`}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* SECTION 2: KALKULATOR ORDER */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center gap-2 mb-4 border-b border-slate-50 pb-3">
            <Calculator className="text-emerald-600" size={20} />
            <h2 className="text-lg font-black text-slate-800">Mulai Order</h2>
          </div>

          <div className="space-y-4">
            {products.length === 0 && (
              <p className="text-center text-sm text-slate-400 py-4">Belum ada produk yang bisa diorder.</p>
            )}

            {products.map((p) => {
              const isHabis = p.stock <= 0;
              const qty = cart[p.name] || 0;
              const isMax = qty >= p.stock;
              
              return (
                <div key={`calc-${p.name}`} className={`flex justify-between items-center p-3 rounded-xl border transition-colors ${isHabis ? 'bg-slate-100 border-slate-200 opacity-60 grayscale' : 'bg-slate-50 border-slate-100 hover:border-emerald-200'}`}>
                  <div className="w-3/5 pr-2">
                    <p className={`text-[11px] font-bold leading-tight ${isHabis ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{p.name}</p>
                    <div className="mt-1.5 flex flex-col items-start gap-1">
                      <p className={`text-xs font-black ${isHabis ? 'text-slate-400' : 'text-emerald-600'}`}>
                         {formatIDR(p.price)} 
                         <span className="text-[9px] font-normal text-slate-400 line-through ml-1">{formatIDR(p.het)}</span>
                      </p>
                      <div className={`inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded border ${isHabis ? 'bg-slate-200 text-slate-400 border-slate-300' : 'text-amber-600 bg-amber-50 border-amber-200'}`}>
                         <TrendingUp className="w-3 h-3 mr-1" />
                         Untung {formatIDR(p.het - p.price)}/pack
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 bg-white p-1 rounded-lg shadow-sm border border-slate-200 shrink-0">
                    <button 
                      onClick={() => updateCart(p.name, -1, p.stock)}
                      disabled={isHabis || qty === 0}
                      className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${isHabis || qty === 0 ? 'bg-slate-50 text-slate-300 cursor-not-allowed' : 'text-slate-500 bg-slate-50 active:bg-slate-200 hover:bg-slate-100'}`}
                    >
                      <Minus size={14} />
                    </button>
                    <span className={`w-5 text-center text-sm font-black ${isHabis ? 'text-slate-300' : 'text-slate-800'}`}>{qty}</span>
                    <button 
                      onClick={() => updateCart(p.name, 1, p.stock)}
                      disabled={isMax || isHabis}
                      className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${isMax || isHabis ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'text-white bg-emerald-500 active:bg-emerald-600 hover:bg-emerald-400'}`}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* SECTION 3: FLOATING BOTTOM BAR (CART SUMMARY) */}
      <div className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 shadow-[0_-10px_25px_-5px_rgba(0,0,0,0.3)] z-50">
        <div className="max-w-md mx-auto p-4 space-y-3">
          
          {/* Rincian Harga Pembayaran */}
          <div className="flex justify-between items-end">
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Total Pembayaran</p>
              <div className="flex items-center space-x-2 mt-1">
                <span className="bg-emerald-500 text-white px-2 py-0.5 rounded text-xs font-black">
                  {totalQty} Pack
                </span>
              </div>
            </div>
            <h2 className="text-2xl font-black text-white">
              {formatIDR(totalHargaNormal)}
            </h2>
          </div>

          {/* INDIKATOR KEUNTUNGAN RESELLER */}
          {totalQty > 0 && (
            <div className="bg-emerald-950/40 border border-emerald-800/50 px-3 py-2 rounded-lg flex justify-between items-center mt-1">
               <span className="text-xs text-emerald-200 font-medium flex items-center">
                  <TrendingUp className="w-4 h-4 mr-1.5 text-amber-400"/> Estimasi Keuntungan Anda:
               </span>
               <span className="text-sm font-black text-amber-400 tracking-wide">
                  +{formatIDR(totalExpectedProfit)}
               </span>
            </div>
          )}

          {/* Tombol Kirim WA */}
          <button 
            onClick={sendOrderToWhatsApp}
            disabled={totalQty === 0}
            className={`w-full py-3.5 rounded-xl font-bold flex items-center justify-center transition-all mt-1 ${
              totalQty > 0 
                ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg shadow-emerald-500/30 active:scale-[0.98]' 
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            <Send className="w-5 h-5 mr-2" />
            Kirim Pesanan (WhatsApp)
          </button>
        </div>
      </div>
      
    </div>
  );
}