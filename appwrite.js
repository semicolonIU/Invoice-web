// Inisialisasi Kredensial dari localStorage
let APPWRITE_ENDPOINT = localStorage.getItem('aw_endpoint') || 'https://sgp.cloud.appwrite.io/v1';
let APPWRITE_PROJECT = localStorage.getItem('aw_project') || '69d9eeb20034b5287618';
let APPWRITE_DATABASE = localStorage.getItem('aw_database') || '69d9f15c0001694b8ef4';
let APPWRITE_COLLECTION = localStorage.getItem('aw_collection') || 'invoice';

const client = new Appwrite.Client();
const databases = new Appwrite.Databases(client);
const account = new Appwrite.Account(client);

function initAppwrite() {
    if(APPWRITE_ENDPOINT && APPWRITE_PROJECT) {
        client
            .setEndpoint(APPWRITE_ENDPOINT)
            .setProject(APPWRITE_PROJECT);
    }
}

initAppwrite();

const API = {
    checkContext() {
        if (!APPWRITE_DATABASE || !APPWRITE_COLLECTION || !APPWRITE_ENDPOINT || !APPWRITE_PROJECT) {
            throw new Error("Konfigurasi Appwrite belum lengkap. Silakan isi di menu Pengaturan.");
        }
    },
    
    async getSession() {
        this.checkContext();
        try {
            return await account.get();
        } catch (error) {
            return null; // Not logged in
        }
    },

    async login(email, password) {
        this.checkContext();
        try {
            // Create session
            const session = await account.createEmailPasswordSession(email, password);
            return session;
        } catch (error) {
            console.error("Login failed:", error);
            throw error;
        }
    },

    async logout() {
        this.checkContext();
        try {
            await account.deleteSession('current');
        } catch (error) {
            console.error("Logout failed:", error);
            throw error;
        }
    },
    
    async getInvoices(limit = 10, offset = 0, searchQuery = "") {
        this.checkContext();
        try {
            const queries = [
                Appwrite.Query.limit(limit),
                Appwrite.Query.offset(offset),
                Appwrite.Query.orderDesc('$createdAt')
            ];

            if (searchQuery) {
                // Mencari berdasarkan NoInvoice atau clientName (Jika clientName adalah array/string)
                // Catatan: Appwrite search query membutuhkan index full-text atau match
                queries.push(Appwrite.Query.or([
                    Appwrite.Query.contains('NoInvoice', [searchQuery]),
                    Appwrite.Query.contains('clientName', [searchQuery])
                ]));
            }

            const response = await databases.listDocuments(APPWRITE_DATABASE, APPWRITE_COLLECTION, queries);
            return {
                documents: response.documents,
                total: response.total
            };
        } catch (error) {
            console.error("Error fetching invoices:", error);
            throw error;
        }
    },

    async getInvoicesStats() {
        this.checkContext();
        try {
            // Ambil data untuk statistik dan metadata (hapus select untuk sementara agar pasti dapat semua field)
            const response = await databases.listDocuments(APPWRITE_DATABASE, APPWRITE_COLLECTION, [
                Appwrite.Query.limit(100) // Ambil 100 data terakhir untuk metadata demi efisiensi
            ]);
            return response.documents;
        } catch (error) {
            console.error("Error fetching stats:", error);
            throw error;
        }
    },

    async createInvoice(data) {
        this.checkContext();
        try {
            const response = await databases.createDocument(
                APPWRITE_DATABASE, 
                APPWRITE_COLLECTION, 
                Appwrite.ID.unique(), 
                data
            );
            return response;
        } catch (error) {
            console.error("Error creating invoice:", error);
            throw error;
        }
    },

    async deleteInvoice(id) {
        this.checkContext();
        try {
            await databases.deleteDocument(APPWRITE_DATABASE, APPWRITE_COLLECTION, id);
        } catch (error) {
            console.error("Error deleting invoice:", error);
            throw error;
        }
    },

    async updateInvoice(id, data) {
        this.checkContext();
        try {
            const response = await databases.updateDocument(
                APPWRITE_DATABASE,
                APPWRITE_COLLECTION,
                id,
                data
            );
            return response;
        } catch (error) {
            console.error("Error updating invoice:", error);
            throw error;
        }
    },

    async updateInvoiceStatus(id, newStatus) {
        this.checkContext();
        try {
            const response = await databases.updateDocument(
                APPWRITE_DATABASE,
                APPWRITE_COLLECTION,
                id,
                { paymentStatus: newStatus }
            );
            return response;
        } catch (error) {
            console.error("Error updating status:", error);
            throw error;
        }
    }
};
