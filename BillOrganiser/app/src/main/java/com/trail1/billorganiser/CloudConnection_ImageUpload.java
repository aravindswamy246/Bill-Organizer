package com.trail1.billorganiser;

import android.app.Application;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Log;

import com.parse.GetDataCallback;
import com.parse.Parse;
import com.parse.ParseException;
import com.parse.ParseFile;
import com.parse.ParseObject;
import com.parse.ParseQuery;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;

public class CloudConnection_ImageUpload extends Application {
    private String userImgDB;
    private String column_Img = "Image";
    private String username;

    private ParseObject imageDB;

    public CloudConnection_ImageUpload(String username){
        this.username = username;
        userImgDB = username;
        imageDB = new ParseObject(userImgDB);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        // Enable Local Database
        Parse.enableLocalDatastore(this);
        // Setting up parse server
        Parse.initialize(new Parse.Configuration.Builder(this)
                .applicationId("myappID")
                // if defined
                .clientKey(null)
                .server("http://ec2-18-216-175-50.us-east-2.compute.amazonaws.com/parse/")
                .build()
        );

    }   // End onCreate method

    public void uploadImage(Bitmap image) {
        ByteArrayOutputStream stream = new ByteArrayOutputStream();

        image.compress(Bitmap.CompressFormat.JPEG, 100, stream);
        byte[] scaledData = stream.toByteArray();

        ParseFile imagePF = new ParseFile("images.jpeg", scaledData);
        imagePF.saveInBackground();
        imageDB.put(column_Img, imagePF);
        imageDB.saveInBackground();
    }

//    public int getImageCount(){
//        List<ParseObject> images_list = null;
//        ParseQuery imageQuery = ParseQuery.getQuery(userImgDB);
//
//        try {
//            images_list = imageQuery.find();
//        } catch (ParseException e) {
//            Log.d("Image Count Error", e.getMessage());
//            e.printStackTrace();
//        }
//
//        if(images_list.size() > 0) {
//            Log.d("Image", " count: "+images_list.size());
//            return images_list.size();
//        }
//        else return 0;
//    }   // End getImageCount()

    public ArrayList<Bitmap> getImages(){
        final ArrayList<Bitmap> bitmaps = new ArrayList<>();
        List<ParseObject> images_list = null;
        ParseQuery imageQuery = ParseQuery.getQuery(userImgDB);
        try {
            images_list = imageQuery.find();
        } catch (ParseException e) {
            Log.d("Images Not found", e.getMessage());
            e.printStackTrace();
        }
        finally {
            if(images_list != null){
                byte[] data;
                for(ParseObject image: images_list){
//                    Log.d("image", "before!");
                    ParseFile img = image.getParseFile(column_Img);
//                    Log.d("image", "after!");
                    data = new byte[0];
                    try{
//                        Log.d("image", "before received!");
                        data =img.getData();
//                        Log.d("image", "received!");
                    }
                    catch (ParseException e){
                        Log.d("No images", "Found!");
                        Log.d("Exception: ", "Images " +e.getMessage());
                    }
                    finally {
                        Bitmap bm = BitmapFactory.decodeByteArray(data, 0, data.length);
                        if(data.length != 0 && bm != null){
//                            Log.d("Image", "Added!");
                            bitmaps.add(bm);
                        }
                        else {
//                            Log.d("Image", "Empty!");
                            continue;
                        }
                    }
//                    Log.d("Image", "Out of finally!");
                }
            }
        }

        return bitmaps;
    }

}   // End CloudConnection_ImageUpload class
