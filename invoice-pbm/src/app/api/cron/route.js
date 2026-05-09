import { NextResponse } from 'next/server';
import { Client, Databases, Query } from 'appwrite';

export async function GET(request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Initialize Appwrite Client for Server-side
    const client = new Client()
      .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT)
      .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID);

    const databases = new Databases(client);

    // ACTION: Ping Database to prevent pausing
    // Simply listing 1 document is enough to count as activity
    const response = await databases.listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_COLLECTION_ID,
      [Query.limit(1)]
    );

    console.log("Appwrite Activity Ping Success:", new Date().toISOString());
    console.log("Documents found:", response.total);

    return NextResponse.json({ 
      success: true, 
      message: 'Appwrite database pinged successfully to avoid pause.',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Cron job error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
