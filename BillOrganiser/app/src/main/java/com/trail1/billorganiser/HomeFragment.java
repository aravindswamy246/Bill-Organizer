/*
 * Author    : Eswar Aravind Swamy Adari
 * Functions : To display images uploaded by the user
 */

package com.trail1.billorganiser;

import android.Manifest;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import android.preference.PreferenceManager;
import android.provider.MediaStore;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.Animation;
import android.view.animation.AnimationUtils;
import android.widget.GridView;
import android.widget.ListAdapter;
import android.widget.TextView;

import com.google.android.material.floatingactionbutton.FloatingActionButton;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

public class HomeFragment extends Fragment {

    private FloatingActionButton uploadFAB, cameraFAB, albumFAB;
    private TextView camTV, albumTV;
    private Animation fabOpenAnim, fabCloseAnim;

    private static final int PICK_IMAGE = 100;
    private static final int PICK_IMAGE_FROM_CAMERA = 101;
    Uri imageUri;
    boolean isOpen = false;

    CloudConnection_ImageUpload imageFromCloud;

    SharedPreferences mySessionPreferences;
    String preferences_un_key = "l_uname";
    String username;

    private GridView myGridView;
    private ImageAdapter myImageAdapter;
    private ArrayList<Bitmap> bitmapList = new ArrayList<>();

    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container,
                             Bundle savedInstanceState) {
        // Inflate the layout for this fragment
        View view = inflater.inflate(R.layout.fragment_home, container, false);

        uploadFAB = view.findViewById(R.id.idUploadFloatBtn);
        cameraFAB = view.findViewById(R.id.idCameraFloatBtn);
        albumFAB = view.findViewById(R.id.idAlbumFloatBtn);
        camTV = view.findViewById(R.id.idCameraTV);
        albumTV = view.findViewById(R.id.idAlbumTV);
        myGridView = view.findViewById(R.id.idHomeGridView);

        fabOpenAnim = AnimationUtils.loadAnimation(getActivity().getApplicationContext(), R.anim.fab_open);
        fabCloseAnim = AnimationUtils.loadAnimation(getActivity().getApplicationContext(), R.anim.fab_close);

        // OnClick to open the floating action button
        uploadFAB.setOnClickListener(new View.OnClickListener(){
            @Override
            public void onClick(View view) {
                if(isOpen){
                    cameraFAB.startAnimation(fabCloseAnim);
                    albumFAB.startAnimation(fabCloseAnim);
                    camTV.setVisibility(View.INVISIBLE);
                    albumTV.setVisibility(View.INVISIBLE);

                    isOpen = false;
                }
                else{
                    cameraFAB.startAnimation(fabOpenAnim);
                    albumFAB.startAnimation(fabOpenAnim);
                    camTV.setVisibility(View.VISIBLE);
                    albumTV.setVisibility(View.VISIBLE);

                    isOpen = true;
                }
            }
        });

        // Setting up the SharedPreferences to save the user's data
        mySessionPreferences = PreferenceManager.getDefaultSharedPreferences(getActivity().getApplicationContext());
        checkLoginSharedPreferences();
        imageFromCloud = new CloudConnection_ImageUpload(username);

        // Recycler View
        boolean viewingUploadedImages = viewUploadedImages();
        Log.d("display", "After UploadedImagesCheck "+viewingUploadedImages);
        Log.d("images", "count in cloud: "+bitmapList.size());
        myImageAdapter = new ImageAdapter(getActivity().getApplicationContext(), bitmapList);
        myGridView.setAdapter((ListAdapter) myImageAdapter);

        //  Open Camera
        cameraFAB.setOnClickListener(new View.OnClickListener(){
            @Override
            public void onClick(View view) {
                try{
                    openCamera();
                }
                catch (Exception e){
                    e.printStackTrace();
                }
            }
        });

        // Open Gallery
        albumFAB.setOnClickListener(new View.OnClickListener(){
            @Override
            public void onClick(View view) {
                try{
                    openGallery();
                }
                catch (Exception e){
                    e.printStackTrace();
                }
            }
        });

//        imageCount = imageFromCloud.getImageCount();

        return view;
    }

    private boolean viewUploadedImages() {
        long startTime = System.nanoTime();
        bitmapList = imageFromCloud.getImages();
        long endTime = System.nanoTime();
        Log.d("Time Taken ", "sec "+Math.round((endTime-startTime)/(10^9)));
        if(bitmapList != null)
            return true;
        else return false;
    }

    // Method to access device camera using MediaStore
    private void openCamera(){

        // Check for permission
        if(ContextCompat.checkSelfPermission(getActivity().getApplicationContext(),
                Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED){
            ActivityCompat.requestPermissions(getActivity(),
                    new String[]{
                            Manifest.permission.CAMERA
                    }, PICK_IMAGE_FROM_CAMERA);
        }
        Intent cameraIntent = new Intent();
        cameraIntent.setAction(MediaStore.ACTION_IMAGE_CAPTURE);
        startActivityForResult(cameraIntent, PICK_IMAGE_FROM_CAMERA);
    }

    // Method to load images from gallery using MediaStore
    private void openGallery(){
        Intent galleryIntent = new Intent(Intent.ACTION_PICK, MediaStore.Images.Media.INTERNAL_CONTENT_URI);
        galleryIntent.setType("image/*");
        startActivityForResult(galleryIntent, PICK_IMAGE);
    }


    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data){
        super.onActivityResult(requestCode, resultCode, data);

        switch (requestCode){
            // Pick image from the gallery
            case PICK_IMAGE:
//                final ImageView billsIV = getView().findViewById(R.id.idBillImgs);
                final List<Bitmap> imgBitmaps = new ArrayList<>();
                ClipData clipData = data.getClipData();

                if(clipData == null){
                    imageUri = data.getData();

//                    Picasso.get().load(imageUri).into(billsIV);
//                    billsIV.setImageURI(imageUri);

                    // Retrieve the images to the inputStream and add` it to bitmap
                    try {
                        InputStream imageStream = getActivity().getContentResolver().openInputStream(imageUri);
                        Bitmap imgBitmap = BitmapFactory.decodeStream(imageStream);
                        imgBitmaps.add(imgBitmap);
                    }
                    catch (Exception e){
                        e.printStackTrace();
                    }

                    // Thread to retrieve only one image from the bitmap set it to the imageview
                    new Thread(new Runnable() {
                        @Override
                        public void run() {
                            for(final Bitmap b: imgBitmaps){
                                getActivity().runOnUiThread(new Runnable(){
                                    @Override
                                    public void run(){
                                        imageFromCloud.uploadImage(b);
//                                        billsIV.setImageBitmap(b);
                                    }
                                });
                                try {
                                    Thread.sleep(2000);
                                }
                                catch (Exception e){
                                    e.printStackTrace();
                                }
                            }
                        }
                    }).start();

                }
                break;

            // Picking image from camera
            case PICK_IMAGE_FROM_CAMERA:
//                final ImageView billsCamIV = getView().findViewById(R.id.idBillImgs);
                Bitmap captureImage = (Bitmap)data.getExtras().get("data");

                // Upload image to cloud
                imageFromCloud.uploadImage(captureImage);
//                billsCamIV.setImageBitmap(captureImage);    // To set image to the display

                break;

            default:
                throw new IllegalStateException("Unexpected value: " + requestCode);
        }

    }   // End onActivityResult() method

    // Method to display user's data based on the user's choice
    private void checkLoginSharedPreferences() {
        username = mySessionPreferences.getString(preferences_un_key, "");
    }

}   // End HomeFragment Class