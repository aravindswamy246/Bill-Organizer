package com.trail1.billorganiser;

import android.content.Context;
import android.graphics.Bitmap;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.GridView;
import android.widget.ImageView;

import java.util.ArrayList;

public class ImageAdapter extends BaseAdapter {
    private Context mContext;
    private ArrayList<Bitmap> mUploads;

    public ImageAdapter(Context context, ArrayList<Bitmap> uploads) {
        mContext = context;
        mUploads = uploads;
    }

    @Override
    public int getCount() {
        return mUploads.size();
    }

    @Override
    public Object getItem(int i) {
        return null;
    }

    @Override
    public long getItemId(int i) {
        return 0;
    }

    @Override
    public View getView(int position, View view, ViewGroup viewGroup) {

        final ImageView imageView;
        if(view == null){
            imageView = new ImageView(mContext);

            // To make sure each image is displayed as you intended, you may need to assign some properties to
            // your ImageViews. I’m going to use setLayoutParams to specify how each image should be resized
            imageView.setLayoutParams(new GridView.LayoutParams(500, 400));

            // setScaleType defines how the image should be scaled and positioned. I’m using the CENTER_CROP
            // value as this maintains the image’s aspect ratio by scaling it in both directions, and then
            // centers the newly-scaled image.
            imageView.setScaleType(ImageView.ScaleType.CENTER_CROP);
        }

        else{
            imageView = (ImageView)view;
        }
        Log.d("Setting", "Image Bitmap "+mUploads.get(position));
        final Bitmap b = mUploads.get(position);
        imageView.setImageBitmap(b);

        return imageView;
    }
}