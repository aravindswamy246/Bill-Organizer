/*
 * Author    : Eswar Aravind Swamy Adari
 * Functions : To store users data on a local data store
 */

package com.trail1.billorganiser;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

public class DatabaseHelper extends SQLiteOpenHelper {
    public static final String DATABASE_NAME = "BillOrganiser.db";
    public static final String REGISTRY_TABLE = "Register_Table";
    public static String BILLS_TABLE;
    public static final String U_FirstName = "firstname";
    public static final String U_LastName = "lastname";
    public static final String U_UserName = "username";
    public static final String U_Email = "email";
    public static final String U_Password = "password";
    public static final String B_Bill = "bill";

    private static String firstname;
    public static int version = 1;

    public DatabaseHelper(Context context) {
        super(context, DATABASE_NAME, null, version);
        SQLiteDatabase db = this.getWritableDatabase();
    }

    @Override
    public void onCreate(SQLiteDatabase db){
        String createQuery = "CREATE TABLE " +REGISTRY_TABLE+ " (ID INTEGER PRIMARY KEY AUTOINCREMENT, "
                        +U_FirstName+ " TEXT, " +U_LastName+ " TEXT, " +U_UserName+ " TEXT UNIQUE, "
                        +U_Email+ " TEXT UNIQUE, " +U_Password+ " TEXT)";
        db.execSQL(createQuery);
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int i, int i1){
        db.execSQL("DROP TABLE IF EXISTS " +REGISTRY_TABLE);
        onCreate(db);
    }

    public void setInformation(){

    }
}
